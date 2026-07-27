from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.schemas import WorkspaceCreate
from backend.services.auth import UserInfo, get_current_user
from backend.services.history import create_workspace, delete_workspace, get_workspaces

router = APIRouter(tags=["workspaces"])


@router.get("/workspaces")
def list_workspaces(current_user: UserInfo = Depends(get_current_user)):
    return {"workspaces": get_workspaces(user_id=current_user.id)}


@router.post("/workspaces", status_code=201)
def add_workspace(body: WorkspaceCreate, current_user: UserInfo = Depends(get_current_user)):
    wid = create_workspace(body.name, current_user.id)
    return {"id": wid, "name": body.name}


@router.delete("/workspaces/{workspace_id}")
def remove_workspace(workspace_id: str, current_user: UserInfo = Depends(get_current_user)):
    delete_workspace(workspace_id, current_user.id)
    return {"message": "Workspace deleted"}
