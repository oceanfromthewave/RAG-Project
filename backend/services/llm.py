from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from functools import lru_cache
from typing import Any, Iterator

# 헤드리스 CLI에 넘길 에이전트 이름. tools를 빈 배열로 줘야 툴이 0개가 된다.
_AGENT_NAME = "rag"

# Opus 4.8은 thinking을 끄면 추론 과정을 답변 본문에 섞어 쓸 수 있다.
_FINAL_ANSWER_ONLY = (
    "Respond only with your final answer. Do not include exploratory reasoning, "
    "intermediate drafts, or meta-commentary about your process."
)

# CLI의 --model이 받는 별칭들. 그 외 이름(mistral 등)은 Claude 모델이 아니다.
_CLAUDE_ALIASES = {"opus", "sonnet", "haiku", "fable"}

# claude 응답 기본 최대 출력 토큰. 비용·응답 절단을 좌우하므로 환경변수로 조정 가능.
DEFAULT_MAX_TOKENS = int(os.getenv("CLAUDE_MAX_TOKENS", "4096"))

_KNOWN_PROVIDERS = {"ollama", "claude"}


def _provider() -> str:
    p = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if p not in _KNOWN_PROVIDERS:
        raise RuntimeError(
            f"LLM_PROVIDER='{p}' 는 지원하지 않습니다. "
            f"{sorted(_KNOWN_PROVIDERS)} 중 하나여야 합니다."
        )
    return p


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


@lru_cache(maxsize=1)
def _claude_bin() -> str:
    name = os.getenv("CLAUDE_BIN", "claude")
    resolved = shutil.which(name)
    if resolved is None:
        raise RuntimeError(f"'{name}' 실행 파일을 PATH에서 찾을 수 없습니다.")
    return resolved


def _cli_timeout() -> int:
    return int(os.getenv("CLAUDE_CLI_TIMEOUT", "180"))


def _claude_model(model: str | None) -> str:
    if model and (model.startswith("claude-") or model in _CLAUDE_ALIASES):
        return model
    return os.getenv("CLAUDE_MODEL", "claude-opus-4-8")


def _ollama_model(model: str | None = None) -> str:
    return model or os.getenv("CHAT_MODEL_NAME", "mistral")


# ── 공통 헬퍼 ──────────────────────────────────────────────
def _wrap(text: str) -> dict:
    """ollama.chat(stream=False)의 반환 모양으로 감싼다."""
    return {"message": {"content": text}}


def _split_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """system 메시지를 분리하고, user/assistant 대화만 남긴다."""
    system = "\n\n".join(
        m["content"] for m in messages
        if m.get("role") == "system" and m.get("content")
    )
    convo = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    while convo and convo[0]["role"] != "user":  # 첫 메시지는 user여야 한다
        convo.pop(0)
    return system, convo


def _flatten(convo: list[dict]) -> str:
    """헤드리스 CLI는 -p로 프롬프트 하나만 받는다. 대화를 한 문자열로 편다."""
    if len(convo) == 1:
        return convo[0]["content"]
    lines = [
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in convo
    ]
    lines.append("Assistant:")
    return "\n\n".join(lines)


# ── ollama (기본 프로바이더) ─────────────────────────────────
def _ollama_chat(model, messages, stream, options):
    import ollama

    kwargs: dict[str, Any] = {
        "model": _ollama_model(model),
        "messages": messages,
        "stream": stream,
    }
    if options:
        kwargs["options"] = options
    return ollama.chat(**kwargs)


# ── 프로바이더 상태 조회 (main.py 의 /health, /models, /stats 가 쓴다) ──
def using_claude() -> bool:
    return _provider() == "claude"


def active_model() -> str:
    """현재 프로바이더가 실제로 쓰는 대화 모델. /stats 와 /models 가 함께 쓴다."""
    if _provider() == "claude":
        return _claude_model(None)
    return _ollama_model()


def claude_auth_mode() -> str:
    return "api_key" if _api_key() else "subscription_cli"


# ── Anthropic API (배포용) ───────────────────────────────────
def _anthropic_kwargs(model, messages, options) -> dict:
    system, convo = _split_messages(messages)
    system = f"{system}\n\n{_FINAL_ANSWER_ONLY}".strip()

    # temperature/top_p/top_k 는 Opus 4.8 에서 400 이므로 넘기지 않는다.
    # num_predict(ollama) → max_tokens 로만 옮긴다.
    kwargs: dict[str, Any] = {
        "model": _claude_model(model),
        "max_tokens": int((options or {}).get("num_predict") or DEFAULT_MAX_TOKENS),
        "messages": convo,
    }
    if system:
        kwargs["system"] = system
    return kwargs


@lru_cache(maxsize=1)
def _anthropic_client():
    import anthropic

    return anthropic.Anthropic()


def _anthropic_chat(model, messages, stream, options):
    client = _anthropic_client()
    kwargs = _anthropic_kwargs(model, messages, options)

    if stream:
        return _anthropic_stream(client, kwargs)

    res = client.messages.create(**kwargs)
    if res.stop_reason == "refusal":
        raise RuntimeError("Claude가 안전상의 이유로 응답을 거부했습니다.")
    return _wrap("".join(b.text for b in res.content if b.type == "text"))


def _anthropic_stream(client, kwargs) -> Iterator[dict]:
    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            if text:
                yield _wrap(text)
        if stream.get_final_message().stop_reason == "refusal":
            raise RuntimeError("Claude가 안전상의 이유로 응답을 거부했습니다.")


# ── Claude Code 헤드리스 CLI (구독 인증, 로컬 개발용) ──────────
def _cli_cmd(model: str | None, system: str, stream: bool) -> list[str]:
    agent = {
        _AGENT_NAME: {
            "description": "RAG answerer",
            "prompt": f"{system}\n\n{_FINAL_ANSWER_ONLY}".strip() or _FINAL_ANSWER_ONLY,
            "tools": [],  # 툴 0개 — 문서 내용을 통한 프롬프트 인젝션 차단
        }
    }
    cmd = [
        _claude_bin(), "-p",
        "--setting-sources", "",  # CLAUDE.md / settings 주입 차단
        "--strict-mcp-config",  # 사용자 MCP 서버 로드 차단
        "--agents", json.dumps(agent, ensure_ascii=False),
        "--agent", _AGENT_NAME,
        "--model", _claude_model(model),
    ]
    if stream:
        cmd += ["--output-format", "stream-json", "--include-partial-messages", "--verbose"]
    else:
        cmd += ["--output-format", "json"]
    return cmd


def _cli_chat(model, messages, stream, _options):
    # CLI 에는 temperature / max_tokens 를 넘길 방법이 없다. options 는 무시된다.
    system, convo = _split_messages(messages)
    if not convo:
        return _wrap("") if not stream else iter(())
    prompt = _flatten(convo)

    if stream:
        return _cli_stream(model, system, prompt)
    return _cli_once(model, system, prompt)


def _cli_once(model, system, prompt) -> dict:
    proc = subprocess.run(
        _cli_cmd(model, system, stream=False),
        input=prompt, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=_cli_timeout(),
    )
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"claude CLI 응답 파싱 실패: {proc.stderr.strip()[:300]}") from e
    # 종료 코드는 오류일 때도 0이다. is_error 로 판정해야 한다.
    if data.get("is_error"):
        raise RuntimeError(f"claude CLI 오류: {data.get('result', '')[:300]}")
    return _wrap(data.get("result", "") or "")


def _cli_stream(model, system, prompt) -> Iterator[dict]:
    proc = subprocess.Popen(
        _cli_cmd(model, system, stream=True),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,  # 스트리밍 경로는 stderr를 파싱 안 함 → PIPE 미소비 데드락 제거
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    # 블로킹 readline은 시계를 못 보므로, 데드라인 초과 시 프로세스를 죽이는 워치독.
    timed_out = threading.Event()

    def _kill_on_timeout():
        timed_out.set()
        if proc.poll() is None:
            proc.kill()

    watchdog = threading.Timer(_cli_timeout(), _kill_on_timeout)
    watchdog.daemon = True
    watchdog.start()

    saw_result = False
    try:
        proc.stdin.write(prompt)
        proc.stdin.close()
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
            except json.JSONDecodeError:
                continue
            etype = evt.get("type")
            if etype == "stream_event":
                inner = evt.get("event", {})
                if inner.get("type") == "content_block_delta":
                    delta = inner.get("delta", {})
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield _wrap(delta["text"])
            elif etype == "result":
                saw_result = True
                if evt.get("is_error"):
                    raise RuntimeError(f"claude CLI 오류: {evt.get('result', '')[:300]}")
    finally:
        watchdog.cancel()
        for pipe in (proc.stdin, proc.stdout):
            if pipe and not pipe.closed:
                pipe.close()
        if proc.poll() is None:
            proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    if timed_out.is_set():
        raise RuntimeError(f"claude CLI 스트리밍 타임아웃 ({_cli_timeout()}s)")
    if not saw_result:
        raise RuntimeError("claude CLI 스트리밍이 result 이벤트 없이 종료되었습니다.")


# ── 공개 API ────────────────────────────────────────────────
def chat(model: str | None = None, messages: list[dict] | None = None,
         stream: bool = False, options: dict | None = None):
    messages = messages or []
    if _provider() != "claude":
        return _ollama_chat(model, messages, stream, options)
    if _api_key():
        return _anthropic_chat(model, messages, stream, options)
    return _cli_chat(model, messages, stream, options)


def health() -> str:
    """/health 엔드포인트용 한 줄 상태.

    실제 LLM 호출은 하지 않는다 — 헬스체크마다 구독 사용량을 태우거나
    프로세스를 3초씩 띄울 이유가 없다.
    """
    if _provider() != "claude":
        import ollama
        info = ollama.list()
        models = info.get("models", []) if isinstance(info, dict) else getattr(info, "models", [])
        return f"ok (ollama, {len(models)} models)"
    if _api_key():
        return f"ok (claude api, {_claude_model(None)})"
    # 키가 없으면 None 을 반환해 헬스체크(v.startswith)가 터지지 않도록 문자열을 돌려준다.
    return "error (claude api key 없음)"
