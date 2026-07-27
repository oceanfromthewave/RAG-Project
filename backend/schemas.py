from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from backend.config import MAX_HISTORY_MESSAGES, MAX_QUESTION_LENGTH, MODEL_NAME_RE
from backend.services.store import normalize_source_name


class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)


class Question(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)
    model: str | None = Field(default=None, max_length=80)
    history: list[Message] | None = Field(default=None, max_length=MAX_HISTORY_MESSAGES)
    session_id: str | None = None
    workspace_id: str | None = None
    selected_files: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("model")
    @classmethod
    def validate_model_name(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return value
        if not MODEL_NAME_RE.fullmatch(value):
            raise ValueError("Invalid model name.")
        return value

    @field_validator("selected_files")
    @classmethod
    def validate_selected_files(cls, value: list[str]) -> list[str]:
        return [normalize_source_name(name) for name in value]


class SessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RoleUpdate(BaseModel):
    is_admin: bool


class FeedbackUpdate(BaseModel):
    feedback: int = Field(ge=-1, le=1)


class PasswordChange(BaseModel):
    old_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=1, max_length=72)


class FileTagsUpdate(BaseModel):
    tags: list[str]
