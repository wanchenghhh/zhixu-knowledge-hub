"""Explicit, idempotent provider setup; no inference or billing during installation."""

from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select
from .config import encrypt
from .db import Model, session_factory, utcnow
from .security import admin, role_header
from .serialize import model_dict

router = APIRouter(prefix="/api/v1/model-presets")
PRESETS = [
    {
        "id": "openrouter",
        "provider": "OpenRouter",
        "title": "OpenRouter 免费模型",
        "pricing": "免费模型，有频率与每日请求限制",
        "description": "使用官方免费路由，仅在免费模型之间选择；不会配置付费模型回退。免费可用性和限额由 OpenRouter 决定。",
        "url": "https://openrouter.ai/api/v1",
        "keyUrl": "https://openrouter.ai/keys",
        "docsUrl": "https://openrouter.ai/docs/guides/routing/routers/free-router",
        "models": [
            {"name": "OpenRouter · 免费对话", "type": "LLM", "model": "openrouter/free", "dimension": None},
        ],
    },
    {
        "id": "tongyi",
        "provider": "通义百炼",
        "title": "通义百炼 · 北京地域",
        "pricing": "限时新人额度，非永久免费",
        "description": "预置对话、向量和重排三类模型。各模型试用额度独立，需在百炼确认剩余额度并开启“免费额度用完即停”，否则可能转为按量计费。",
        "url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "keyUrl": "https://help.aliyun.com/zh/model-studio/get-api-key",
        "docsUrl": "https://help.aliyun.com/zh/model-studio/new-free-quota/",
        "models": [
            {"name": "通义 · 轻量对话", "type": "LLM", "model": "qwen-flash", "dimension": None},
            {"name": "通义 · 向量", "type": "Embedding", "model": "text-embedding-v4", "dimension": 1024},
            {"name": "通义 · 重排", "type": "Rerank", "model": "gte-rerank-v2", "dimension": None},
        ],
    },
]


def database():
    with session_factory()() as db:
        yield db


@router.get("")
def catalog(db=Depends(database), role=Depends(role_header)):
    admin(role)
    return [
        {
            **preset,
            "hasStoredKey": bool(
                db.scalar(
                    select(Model.id)
                    .where(
                        Model.provider == preset["provider"], Model.url == preset["url"], Model.secret != ""
                    )
                    .limit(1)
                )
            ),
        }
        for preset in PRESETS
    ]


class InstallInput(BaseModel):
    apiKey: SecretStr | None = Field(default=None, max_length=2000)
    freeQuotaConfirmed: bool = False


@router.post("/{id}/install")
def install(id: str, body: InstallInput, db=Depends(database), role=Depends(role_header)):
    admin(role)
    preset = next((item for item in PRESETS if item["id"] == id), None)
    if not preset:
        raise HTTPException(404, "模型接入预设不存在")
    key = body.apiKey.get_secret_value().strip() if body.apiKey else ""
    existing_secret = db.scalar(
        select(Model.secret)
        .where(Model.provider == preset["provider"], Model.url == preset["url"], Model.secret != "")
        .limit(1)
    )
    if id == "tongyi" and (key or existing_secret) and not body.freeQuotaConfirmed:
        raise HTTPException(
            400, "请先在百炼确认免费额度，并开启三个模型的“免费额度用完即停”；本站无法读取或替你保证剩余额度"
        )
    secret = encrypt(key) if key else existing_secret or ""
    models = []
    for values in preset["models"]:
        model = db.scalar(
            select(Model)
            .where(
                Model.provider == preset["provider"],
                Model.url == preset["url"],
                Model.type == values["type"],
                Model.model == values["model"],
            )
            .limit(1)
        )
        if model is None:
            model = Model(
                id=str(uuid4()), provider=preset["provider"], url=preset["url"], secret=secret, **values
            )
            db.add(model)
        elif key or (not model.secret and secret):
            model.secret = secret
            model.status, model.error, model.updated = "untested", None, utcnow()
        models.append(model)
    db.commit()
    return {
        "models": [model_dict(model) for model in models],
        "connected": all(model.secret and model.status == "ready" for model in models),
        "message": "预设已保存，请填写密钥后执行连接测试",
    }
