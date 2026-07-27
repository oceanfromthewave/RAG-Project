from __future__ import annotations

import os
import re

# ── 환경 ────────────────────────────────────────────────────
APP_ENV = os.getenv("APP_ENV", os.getenv("NODE_ENV", "development")).lower()

# ── CORS / 업로드 / 요청 제한 ───────────────────────────────
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 10485760))
MAX_FILES_PER_UPLOAD = int(os.getenv("MAX_FILES_PER_UPLOAD", 5))
MAX_QUESTION_LENGTH = int(os.getenv("MAX_QUESTION_LENGTH", 4000))
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", 12))

ALLOW_REGISTRATION = os.getenv(
    "ALLOW_REGISTRATION",
    "false" if APP_ENV in {"prod", "production"} else "true",
).lower() == "true"

MODEL_NAME_RE = re.compile(r"^[A-Za-z0-9_.:/-]{1,80}$")

ALLOWED_EXTENSIONS = {
    ".txt", ".pdf", ".docx", ".py", ".js", ".ts", ".jsx", ".tsx",
    ".html", ".css", ".json", ".md", ".java", ".c", ".cpp", ".h", ".go",
    ".yaml", ".yml", ".sql", ".sh", ".bash", ".png", ".jpg", ".jpeg"
}
