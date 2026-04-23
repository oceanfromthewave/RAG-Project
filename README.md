# RAG 프로젝트: 로컬 문서 기반 지능형 채팅

FastAPI와 React를 기반으로 구축된 이 프로젝트는 로컬 문서를 안전하고 개인적으로 분석하고 채팅할 수 있는 RAG(Retrieval-Augmented Generation) 시스템입니다.

## 🌟 개요

이 프로젝트는 개인 문서(PDF 및 TXT)를 인덱싱하고 채팅할 수 있는 풀스택 솔루션을 제공합니다. Ollama를 통한 로컬 대규모 언어 모델(LLM)을 활용하여 데이터가 외부로 유출되지 않으므로 보안성이 뛰어납니다.

## 🛠️ 기술 스택

- **Backend:** [FastAPI](https://fastapi.tiangolo.com/) (Python)
- **Frontend:** [React](https://react.dev/) with [Vite](https://vitejs.dev/)
- **Vector Database:** [ChromaDB](https://www.trychroma.com/)
- **Embeddings:** `BAAI/bge-m3` (Sentence-Transformers 활용)
- **LLM:** [Ollama](https://ollama.com/) (Mistral/Llama 등)
- **Document Processing:** PyPDF

## 📂 프로젝트 구조

```text
rag-project/
├── backend/          # FastAPI 애플리케이션 및 RAG 로직
├── frontend/         # React SPA (Vite 기반)
├── data/docs/        # 원본 문서 디렉토리 (PDF/TXT)
├── db/               # 로컬 벡터 저장소 (ChromaDB)
├── requirements.txt  # Python 환경 의존성 파일
└── .gitignore        # Git 제외 규칙 설정
```

## 🚀 시작하기

### 1. 사전 준비 사항
- **Python:** 3.10 이상
- **Node.js:** v18 이상
- **Ollama:** [ollama.com](https://ollama.com/)에서 다운로드 및 설치

### 2. 백엔드 설치
```bash
# 루트 디렉토리에서 가상환경 설정
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt
```

### 3. 프론트엔드 설치
```bash
cd frontend
npm install
```

### 4. 애플리케이션 실행
1. **Ollama 실행:** Ollama 서비스가 실행 중인지 확인합니다 (`ollama serve`).
2. **문서 인덱싱(Ingest):**
   ```bash
   # 루트 디렉토리에서 실행
   python -m backend.ingest
   ```
3. **백엔드 실행:**
   ```bash
   python -m uvicorn backend.main:app --reload
   ```
4. **프론트엔드 실행:**
   ```bash
   cd frontend
   npm run dev
   ```

## 🔒 보안 및 개인정보 보호
- **100% 로컬 처리:** 모든 처리(임베딩, 검색, LLM 추론)가 로컬 환경에서 이루어집니다.
- **데이터 격리:** 문서는 `data/docs/`에 보관되며 로컬 `db/` 폴더에 인덱싱됩니다.
