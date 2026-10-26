from typing import Literal
from urllib.parse import urlparse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .config import settings


class ModelInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    provider: Literal["AIHubMix", "OpenRouter", "通义百炼"]
    type: Literal["LLM", "Embedding", "Rerank"]
    model: str = Field(min_length=1, max_length=200)
    url: str
    apiKey: str | None = Field(default=None, max_length=2000)
    dimension: int | None = Field(default=None, ge=64, le=4096)
    timeout: int = Field(default=60, ge=5, le=180)

    @field_validator("name", "model")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("不能为空")
        return value.strip()

    @field_validator("url")
    @classmethod
    def valid_url(cls, value):
        parsed = urlparse(value)
        allowed = {
            "aihubmix.com",
            "api.aihubmix.com",
            "openrouter.ai",
            "dashscope.aliyuncs.com",
            "dashscope-intl.aliyuncs.com",
            "dashscope-us.aliyuncs.com",
        }
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("接口地址不能包含凭证、查询参数或片段")
        if parsed.scheme != "https" or parsed.hostname not in allowed:
            if not (settings().allow_local_models and parsed.scheme in {"http", "https"}):
                raise ValueError("请填写所支持服务商的 HTTPS 接口地址")
        return value.rstrip("/")


class KnowledgeInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="通用知识", max_length=40)
    embedding: str
    rerankModel: str | None = None
    rerank: bool = True
    topK: int = Field(default=5, ge=1, le=20)
    threshold: float = Field(default=0.3, ge=0, le=1)
    prompt: str = Field(
        default="请根据资料回答，使用 [1] 格式标注引用。没有依据时明确说明。", max_length=10000
    )
    visible: list[Literal["admin", "manager", "user"]] = Field(default_factory=lambda: ["admin", "manager"])

    @field_validator("name")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("知识库名称不能为空")
        return value.strip()


class ParseOptions(BaseModel):
    chunkSize: int = Field(default=800, ge=100, le=4000)
    overlap: int = Field(default=100, ge=0, le=1000)
    parseMode: Literal["auto", "enhanced"] = "auto"


class RetrievalInput(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    kbIds: list[str] = Field(min_length=1, max_length=10)
    topK: int = Field(default=5, ge=1, le=20)
    threshold: float = Field(default=0.3, ge=0, le=1)
    rerank: bool = True

    @field_validator("question")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("问题不能为空")
        return value.strip()


class ChatInput(RetrievalInput):
    modelId: str
    conversationId: str | None = None


class OCRInput(BaseModel):
    enabled: bool = False
    region: Literal["cn-hangzhou"] = "cn-hangzhou"
    accessKeyId: str | None = Field(default=None, max_length=200)
    accessKeySecret: str | None = Field(default=None, max_length=2000)
