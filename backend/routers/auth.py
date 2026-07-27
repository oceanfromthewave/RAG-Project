from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.config import ALLOW_REGISTRATION
from backend.core.security import get_client_ip, login_guard, login_limiter, register_limiter
from backend.schemas import PasswordChange
from backend.services.auth import (
    Token,
    UserCreate,
    UserInfo,
    change_password,
    create_access_token,
    create_user,
    get_current_user,
    get_user_by_username,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=201)
def register(request: Request, body: UserCreate):
    register_limiter.check(request)
    if not ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Public registration is disabled.")
    try:
        user = create_user(body.username, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(user["id"], user["username"], user["is_admin"])
    return Token(access_token=token, token_type="bearer", username=user["username"], is_admin=user["is_admin"])


@router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    login_limiter.check(request)
    ip = get_client_ip(request)
    login_guard.check(form.username, ip)

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = get_user_by_username(form.username)
    if not user:
        login_guard.record_failure(form.username, ip)
        raise generic_error

    if not verify_password(form.password, user["hashed_password"]):
        login_guard.record_failure(form.username, ip)
        raise generic_error

    login_guard.clear(form.username, ip)
    token = create_access_token(user["id"], user["username"], user["is_admin"])
    return Token(access_token=token, token_type="bearer", username=user["username"], is_admin=user["is_admin"])


@router.get("/me", response_model=UserInfo)
def me(current_user: UserInfo = Depends(get_current_user)):
    return current_user


@router.post("/change-password")
def change_password_endpoint(
        body: PasswordChange,
        current_user: UserInfo = Depends(get_current_user),
):
    try:
        change_password(current_user.id, body.old_password, body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": "비밀번호가 성공적으로 변경되었습니다."}
