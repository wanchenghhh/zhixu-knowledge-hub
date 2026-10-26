import re
from typing import Annotated, Literal
from uuid import UUID
from fastapi import Header, HTTPException
from openai import APIConnectionError, APIStatusError, APITimeoutError
from sqlalchemy.orm import Session
from .db import Knowledge

Role = Literal["admin", "manager", "user"]


def role_header(x_role: Annotated[Role, Header()] = "user") -> Role:
    return x_role


def browser_header(x_session_id: Annotated[str, Header()] = "") -> str:
    try:
        return str(UUID(x_session_id))
    except ValueError:
        raise HTTPException(400, "缺少有效的浏览器会话标识") from None


def admin(role):
    if role != "admin":
        raise HTTPException(403, "此操作需要管理员角色")


def managed(role):
    if role == "user":
        raise HTTPException(403, "使用者不能修改知识库")


def get_kb(db: Session, kb_id: str, role: str) -> Knowledge:
    kb = db.get(Knowledge, kb_id)
    if not kb or (role != "admin" and role not in kb.visible):
        raise HTTPException(404, "知识库不存在或当前角色不可见")
    return kb


def safe_error(exc: Exception, secrets=()) -> str:
    if isinstance(exc, APIStatusError):
        trace = re.sub(r"[^A-Za-z0-9_.:-]", "", exc.request_id or "")[:100]
        return f"模型服务 HTTP {exc.status_code}；请求标识：{trace or '未提供'}"
    if isinstance(exc, APITimeoutError):
        return "模型服务请求超时，请检查网络或增加请求超时时间"
    if isinstance(exc, APIConnectionError):
        return "模型服务网络连接失败，请检查网络与接口地址"
    message = str(exc)
    for secret in secrets:
        if secret:
            message = message.replace(secret, "[已隐藏]")
    message = re.sub(
        r"(?i)(bearer\s+|api[_-]?key[\s:=\"']+|accesskeysecret[\s:=\"']+)[^\s,\"'}]+", r"\1[已隐藏]", message
    )
    message = re.sub(r"\bsk-[A-Za-z0-9_-]+", "[已隐藏]", message)
    return message[:1000]
