export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const QUICK_PROMPTS = [
  "방금 업로드한 문서 핵심만 요약해줘",
  "문서에 나온 주요 리스크를 정리해줘",
  "인덱싱된 문서 기준으로 할 일을 뽑아줘",
  "현재 프로젝트의 전체 일정을 요약해줘",
  "기술 요구사항 중 누락된 부분이 있는지 확인해줘",
  "보안 가이드라인 위반 사례를 찾아줘",
];

export const INITIAL_STATS = {
  indexed_files: 0,
  total_chunks: 0,
  embed_model: "-",
  reranker_model: "-",
  chat_model: "-",
};

export const WELCOME_MESSAGE =
  "인덱싱된 사내 문서에 대해 질문해보세요. 근거 문서와 검색 문맥까지 함께 보여드릴게요.";

export const TEXT = {
  ready: "준비됐습니다.",
  thinking: "답변을 생성하고 있습니다...",
  answerReady: "답변이 준비됐습니다.",
  requestFailed: "요청 처리에 실패했습니다.",
  answerFailed: "답변을 불러오지 못했습니다.",
  uploadFailed: "업로드에 실패했습니다.",
  deleteFailed: "삭제에 실패했습니다.",
  dragIdle: "PDF 또는 TXT 파일을 끌어다 놓거나 클릭해서 업로드하세요.",
  dragActive: "여기에 파일을 놓으면 바로 인덱싱합니다.",
};
