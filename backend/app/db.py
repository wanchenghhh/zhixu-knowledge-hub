from datetime import datetime, timezone
from functools import lru_cache
from sqlalchemy import (
    JSON,
    UniqueConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from pgvector.sqlalchemy import Vector
from .config import settings


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


JSON_COLUMN = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class Model(Base):
    __tablename__ = "model_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    provider: Mapped[str] = mapped_column(String(40))
    type: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(600))
    secret: Mapped[str] = mapped_column(Text, default="")
    dimension: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timeout: Mapped[int] = mapped_column(Integer, default=60)
    status: Mapped[str] = mapped_column(String(20), default="untested")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Knowledge(Base):
    __tablename__ = "knowledge_bases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), default="通用知识")
    visible: Mapped[list] = mapped_column(JSON_COLUMN, default=lambda: ["admin", "manager"])
    embedding: Mapped[str] = mapped_column(ForeignKey("model_configs.id"))
    rerank_model: Mapped[str | None] = mapped_column(ForeignKey("model_configs.id"), nullable=True)
    rerank: Mapped[bool] = mapped_column(default=True)
    top_k: Mapped[int] = mapped_column(Integer, default=5)
    threshold: Mapped[float] = mapped_column(Float, default=0.3)
    prompt: Mapped[str] = mapped_column(
        Text, default="请严格根据资料回答，使用 [1] 格式引用来源。依据不足时说明未找到答案。"
    )
    generation: Mapped[str] = mapped_column(String(36))
    updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class File(Base):
    __tablename__ = "knowledge_files"
    __table_args__ = (UniqueConstraint("kb_id", "sha256", "options_hash"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(240))
    extension: Mapped[str] = mapped_column(String(10))
    size: Mapped[int] = mapped_column(Integer)
    options_hash: Mapped[str] = mapped_column(String(64))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    blocks: Mapped[list] = mapped_column(JSON_COLUMN, default=list)
    options: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    cloud_jobs: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Chunk(Base):
    __tablename__ = "knowledge_chunks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("knowledge_files.id", ondelete="CASCADE"), index=True)
    generation: Mapped[str] = mapped_column(String(36), index=True)
    content: Mapped[str] = mapped_column(Text)
    location: Mapped[str] = mapped_column(String(600))
    metadata_json: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    terms: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list] = mapped_column(Vector().with_variant(JSON, "sqlite"))


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kb_id: Mapped[str] = mapped_column(ForeignKey("knowledge_bases.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), index=True, default="queued")
    file_ids: Mapped[list] = mapped_column(JSON_COLUMN, default=list)
    options: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    finished: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str] = mapped_column(String(40), default="排队中")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    touched: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    browser_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(120))
    kb_ids: Mapped[list] = mapped_column(JSON_COLUMN)
    messages: Mapped[list] = mapped_column(JSON_COLUMN, default=list)
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class QueryLog(Base):
    __tablename__ = "query_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    kb_ids: Mapped[list] = mapped_column(JSON_COLUMN)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20))
    tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[float] = mapped_column(Float, default=0)
    model: Mapped[str] = mapped_column(String(200))
    sources: Mapped[list] = mapped_column(JSON_COLUMN, default=list)
    details: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON_COLUMN, default=dict)


@lru_cache
def engine():
    url = settings().database_url
    e = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 30}
        if url.startswith("sqlite")
        else {"prepare_threshold": None},
        pool_pre_ping=True,
    )
    if url.startswith("sqlite"):

        @event.listens_for(e, "connect")
        def configure(conn, _):
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA journal_mode=WAL")

    return e


def session_factory():
    return sessionmaker(engine(), expire_on_commit=False)


def init_db():
    if engine().dialect.name == "postgresql":
        from sqlalchemy import text

        with engine().begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine())
    if engine().dialect.name == "postgresql":
        from sqlalchemy import text

        with engine().begin() as conn:
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS chunks_terms_gin ON knowledge_chunks USING gin(to_tsvector('simple', terms))"
                )
            )
