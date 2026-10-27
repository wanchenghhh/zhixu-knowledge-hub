from typing import Literal
from urllib.parse import urlparse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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


class MetadataField(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=80)
    type: Literal["文本", "多值文本", "日期", "数字"] = "文本"
    description: str = Field(default="", max_length=1000)
    generated: bool = False
    enabled: bool = True


class MetadataFilter(BaseModel):
    field: str = Field(min_length=1, max_length=64)
    operator: Literal["eq", "contains", "gte", "lte"] = "eq"
    value: str | float = Field(union_mode="left_to_right")


class ParseOptions(BaseModel):
    chunkSize: int = Field(default=800, ge=10, le=6000)
    lengthUnit: Literal["characters", "tokens"] = "characters"
    overlap: int = Field(default=100, ge=0, le=1000)
    parseMode: Literal["auto", "enhanced"] = "auto"
    strategy: Literal["smart", "structure", "custom", "semantic", "qa"] = "smart"
    boundary: Literal["length", "heading", "page", "paragraph", "regex", "delimiter"] = "paragraph"
    separator: str = Field(default=r"\n\n", max_length=200)
    delimiters: list[str] = Field(default_factory=lambda: ["\n\n"], min_length=1, max_length=20)
    delimiterPosition: Literal["start", "end", "remove"] = "start"
    headingLevel: int = Field(default=2, ge=1, le=6)
    tableHeader: bool = True
    parent: bool = True
    parentSize: int = Field(default=2400, ge=100, le=12000)
    semanticThreshold: float = Field(default=0.65, ge=0, le=1)
    extractMetadata: bool = True
    extractionModel: str | None = None
    questionMode: Literal["extract", "existing"] = "extract"

    @model_validator(mode="after")
    def valid_chunks(self):
        if any(not value or len(value) > 100 for value in self.delimiters):
            raise ValueError("分隔符不能为空，单个分隔符不能超过100字符")
        if self.overlap >= self.chunkSize:
            raise ValueError("重叠长度必须小于片段长度")
        if self.parent and self.parentSize < self.chunkSize:
            raise ValueError("父片段长度不能小于子片段长度")
        if self.strategy == "custom" and self.boundary == "regex":
            import regex

            try:
                expression = regex.compile(self.separator)
                if expression.search(""):
                    raise ValueError("表达式不能匹配空文本")
            except regex.error as exc:
                raise ValueError("正则表达式无效") from exc
        return self


class RetrievalInput(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    kbIds: list[str] = Field(min_length=1, max_length=10)
    topK: int = Field(default=5, ge=1, le=20)
    threshold: float = Field(default=0.3, ge=0, le=1)
    rerank: bool = True
    currentOnly: bool = True
    metadataFilters: list[MetadataFilter] = Field(default_factory=list, max_length=20)

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


class ProcessingConfig(BaseModel):
    options: ParseOptions = Field(default_factory=ParseOptions)
    fields: list[MetadataField] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def unique_fields(self):
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("字段标识不能重复")
        return self


class ApplicationConfig(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    kind: Literal["service", "report"]
    model: str
    kbIds: list[str] = Field(min_length=1, max_length=10)
    prompt: str = Field(min_length=1, max_length=12000)
    welcome: str = Field(default="", max_length=2000)
    questions: list[str] = Field(default_factory=list, max_length=10)
    fields: list[str] = Field(default_factory=list, max_length=10)
    visible: list[Literal["admin", "manager", "user"]] = Field(
        default_factory=lambda: ["admin", "manager", "user"]
    )
    history: int = Field(default=6, ge=0, le=20)
    topK: int = Field(default=5, ge=1, le=20)
    threshold: float = Field(default=0.3, ge=0, le=1)
    rerank: bool = True
    currentOnly: bool = True
    metadataFilters: list[MetadataFilter] = Field(default_factory=list, max_length=20)
    filters: str = Field(default="", max_length=0)
    outline: str = Field(default="", max_length=6000)
    format: Literal["markdown", "docx"] = "markdown"

    @model_validator(mode="after")
    def clean(self):
        if not self.name.strip() or not self.prompt.strip():
            raise ValueError("应用名称和角色指令不能为空")
        if len(set(self.fields)) != len(self.fields) or any(
            not f.strip() or len(f) > 80 for f in self.fields
        ):
            raise ValueError("输入字段名称应唯一且不超过 80 字符")
        if any(len(q) > 1000 for q in self.questions):
            raise ValueError("建议问题过长")
        return self


class ApplicationInput(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    inputs: dict[str, str] = Field(default_factory=dict)
    conversationId: str | None = None
