import asyncio
import hashlib
import json
import threading
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Annotated
from uuid import uuid4
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File as UploadField,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy import update, delete, func, select, text
from .chat import stream_chat
from .config import decrypt, encrypt, settings
from .db import (
    Chunk,
    Conversation,
    File,
    Job,
    Knowledge,
    Model,
    QueryLog,
    Setting,
    engine,
    session_factory,
    utcnow,
)
from .documents import EXTENSIONS, file_path
from .jobs import local_worker, new_job
from .providers import test_model
from .retrieval import KnowledgeRetriever, as_source
from .schemas import ChatInput, KnowledgeInput, ModelInput, OCRInput, ParseOptions, RetrievalInput
from .security import admin, browser_header, get_kb, managed, role_header, safe_error
from .serialize import file_dict, job_dict, kb_dict, model_dict, state_dict
from .tasks import notify_job, recover_deliveries
from .storage import persist, remove as remove_original
from .uploads import router as uploads_router
from .knowledge_api import router as knowledge_router
from .applications_api import router as applications_router
from .model_presets import router as model_presets_router
from fastapi.middleware.gzip import GZipMiddleware


def database():
    with session_factory()() as db:
        yield db


DB = Annotated[object, Depends(database)]
Role = Annotated[str, Depends(role_header)]
Browser = Annotated[str, Depends(browser_header)]


@asynccontextmanager
async def lifespan(app):
    if settings().environment != "production":
        from .migrate import upgrade_database

        upgrade_database()
    with session_factory()() as db:
        if engine().dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(8011391)"))
        db.execute(
            delete(QueryLog).where(
                QueryLog.created < utcnow() - timedelta(days=settings().log_retention_days)
            )
        )
        if not db.scalar(select(func.count()).select_from(Model)) and settings().model_bootstrap:
            for config in json.loads(settings().model_bootstrap):
                allowed = {
                    k: v
                    for k, v in config.items()
                    if k
                    in {
                        "id",
                        "name",
                        "type",
                        "provider",
                        "model",
                        "url",
                        "dimension",
                        "timeout",
                        "status",
                        "secret",
                    }
                }
                db.add(Model(**allowed))
            db.flush()
        if not db.scalar(select(func.count()).select_from(Model)):
            for kind, id, name, model, dimension in [
                ("LLM", "llm-aihubmix", "AIHubMix · 对话", "qwen-plus", None),
                ("Embedding", "embed-aihubmix", "AIHubMix · 向量", "text-embedding-v4", 1024),
                ("Rerank", "rerank-aihubmix", "AIHubMix · 重排", "gte-rerank-v2", None),
            ]:
                db.add(
                    Model(
                        id=id,
                        name=name,
                        type=kind,
                        provider="AIHubMix",
                        model=model,
                        url="https://aihubmix.com/v1",
                        dimension=dimension,
                    )
                )
        db.commit()
    stop = threading.Event()
    worker = None
    if settings().queue_mode == "local":
        worker = threading.Thread(target=local_worker, args=(stop,), daemon=True, name="knowledge-worker")
        worker.start()
    yield
    stop.set()
    if worker:
        await asyncio.to_thread(worker.join, 3)


app = FastAPI(title="知序知识中台 API", version="1.2.4", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.include_router(uploads_router)
app.include_router(knowledge_router)
app.include_router(applications_router)
app.include_router(model_presets_router)


@app.middleware("http")
async def request_id(request, call_next):
    request.state.request_id = str(uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse(
        {
            "code": f"HTTP_{exc.status_code}",
            "message": exc.detail,
            "request_id": getattr(request.state, "request_id", ""),
        },
        status_code=exc.status_code,
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic input values may contain API keys; never echo validation input.
    errors = [{"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(
        {
            "code": "VALIDATION_ERROR",
            "message": "提交的参数不正确",
            "errors": errors,
            "request_id": getattr(request.state, "request_id", ""),
        },
        status_code=422,
    )


@app.exception_handler(ValueError)
async def value_error(request, exc):
    return JSONResponse(
        {
            "code": "INVALID_OPERATION",
            "message": safe_error(exc),
            "request_id": getattr(request.state, "request_id", ""),
        },
        status_code=400,
    )


@app.get("/api/v1/health")
def health(db: DB):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok",
        "database": engine().dialect.name,
        "queue": settings().queue_mode,
        "mode": "live",
        "version": "1.2.4",
        "storage": settings().storage_backend,
        "uploadStrategy": "chunked" if settings().storage_backend == "vercel_blob" else "multipart",
    }


@app.get("/api/v1/state")
def state(db: DB, role: Role, browser: Browser, background_tasks: BackgroundTasks):
    if settings().queue_mode == "vercel":
        background_tasks.add_task(recover_deliveries)
    return state_dict(db, role, browser)


@app.post("/api/v1/models")
def create_model(body: ModelInput, db: DB, role: Role):
    admin(role)
    values = body.model_dump(exclude={"apiKey"})
    model = Model(id=str(uuid4()), **values, secret=encrypt(body.apiKey) if body.apiKey else "")
    db.add(model)
    db.commit()
    return model_dict(model)


@app.put("/api/v1/models/{id}")
def update_model(id: str, body: ModelInput, db: DB, role: Role):
    admin(role)
    model = db.get(Model, id)
    if not model:
        raise HTTPException(404, "模型配置不存在")
    if db.scalar(select(Knowledge.id).where(Knowledge.embedding == id).limit(1)) and any(
        getattr(model, k) != getattr(body, k) for k in ["model", "url", "dimension", "provider", "type"]
    ):
        raise HTTPException(409, "向量模型已被知识库绑定。请新增模型配置，再在知识库中更换并重建索引。")
    if db.scalar(select(Knowledge.id).where(Knowledge.rerank_model == id).limit(1)) and body.type != "Rerank":
        raise HTTPException(409, "已绑定的重排模型不能改为其他能力类型")
    for key, value in body.model_dump(exclude={"apiKey"}).items():
        setattr(model, key, value)
    if body.apiKey:
        model.secret = encrypt(body.apiKey)
    model.status, model.error, model.updated = "untested", None, utcnow()
    db.commit()
    return model_dict(model)


@app.delete("/api/v1/models/{id}")
def remove_model(id: str, db: DB, role: Role):
    admin(role)
    if db.scalar(
        select(Knowledge.id).where((Knowledge.embedding == id) | (Knowledge.rerank_model == id)).limit(1)
    ):
        raise HTTPException(409, "模型仍被知识库绑定，请先更换")
    model = db.get(Model, id)
    if model:
        db.delete(model)
        db.commit()
    return {"deleted": True}


@app.post("/api/v1/models/{id}/test")
def model_test(id: str, db: DB, role: Role):
    admin(role)
    model = db.get(Model, id)
    if not model:
        raise HTTPException(404, "模型不存在")
    try:
        detail = test_model(model)
        model.status, model.error = "ready", None
        db.commit()
        return {"model": model_dict(model), "result": detail}
    except Exception as exc:
        model.status, model.error = "failed", safe_error(exc, [decrypt(model.secret)])
        db.commit()
        raise HTTPException(400, model.error) from None


def validate_kb_models(db, body):
    model = db.get(Model, body.embedding)
    if not model or model.type != "Embedding" or model.status != "ready":
        raise HTTPException(400, "请选择已经测试通过的向量模型")
    if body.rerankModel:
        model = db.get(Model, body.rerankModel)
        if not model or model.type != "Rerank" or model.status != "ready":
            raise HTTPException(400, "重排模型尚未就绪")


@app.post("/api/v1/knowledge")
def create_kb(body: KnowledgeInput, db: DB, role: Role):
    managed(role)
    validate_kb_models(db, body)
    visible = list(dict.fromkeys(["admin", *body.visible]))
    if role == "manager" and "manager" not in visible:
        visible.append("manager")
    kb = Knowledge(
        id=str(uuid4()),
        name=body.name.strip(),
        description=body.description,
        category=body.category,
        embedding=body.embedding,
        generation=str(uuid4()),
        visible=visible,
        rerank_model=body.rerankModel,
        rerank=body.rerank,
        top_k=body.topK,
        threshold=body.threshold,
        prompt=body.prompt,
    )
    db.add(kb)
    db.commit()
    return kb_dict(kb)


@app.put("/api/v1/knowledge/{id}")
def update_kb(id: str, body: KnowledgeInput, db: DB, role: Role):
    managed(role)
    kb = get_kb(db, id, role)
    validate_kb_models(db, body)
    if role == "manager" and "manager" not in body.visible:
        raise HTTPException(403, "管理人员不能移除自身角色的可见权限")
    job = None
    if body.embedding != kb.embedding:
        if db.scalar(select(Job.id).where(Job.kb_id == id, Job.status.in_(["queued", "running"])).limit(1)):
            raise HTTPException(409, "知识库有待处理任务，请完成后再更换向量模型")
        files = list(
            db.scalars(select(File.id).where(File.kb_id == id, File.status.in_(["ready", "disabled"])))
        )
        if files:
            job = new_job(db, id, "reindex", files, {"modelId": body.embedding, "generation": str(uuid4())})
        else:
            kb.embedding = body.embedding
    kb.name, kb.description, kb.category, kb.prompt = (
        body.name.strip(),
        body.description,
        body.category,
        body.prompt,
    )
    kb.visible = list(dict.fromkeys(["admin", *body.visible]))
    kb.rerank = body.rerank
    kb.rerank_model = body.rerankModel
    kb.top_k, kb.threshold, kb.updated = body.topK, body.threshold, utcnow()
    db.commit()
    if job:
        notify_job(job.id)
    return {"knowledge": kb_dict(kb), "task": job_dict(job) if job else None}


@app.delete("/api/v1/knowledge/{id}")
def remove_kb(id: str, db: DB, role: Role):
    managed(role)
    kb = get_kb(db, id, role)
    if db.scalar(select(Job.id).where(Job.kb_id == id, Job.status == "running").limit(1)):
        raise HTTPException(409, "请等待当前任务完成后再删除")
    files = list(db.scalars(select(File).where(File.kb_id == id)))
    db.delete(kb)
    db.commit()
    for file in files:
        remove_original(file)
    return {"deleted": True}


@app.post("/api/v1/knowledge/{id}/upload")
async def upload(
    id: str,
    db: DB,
    role: Role,
    file: UploadFile = UploadField(...),
    options: str = Form("{}"),
    consent: bool = Form(False),
):
    managed(role)
    get_kb(db, id, role)
    if not consent:
        raise HTTPException(400, "请先确认解析可能调用云端服务")
    try:
        parsed = ParseOptions.model_validate_json(options)
    except ValueError:
        raise HTTPException(400, "解析参数不正确") from None
    if parsed.overlap >= parsed.chunkSize:
        raise HTTPException(400, "重叠长度必须小于分块长度")
    guard_reindex(db, id)
    name = (file.filename or "").replace("\\", "/").split("/")[-1]
    if not name or len(name) > 240 or any(ord(c) < 32 for c in name):
        raise HTTPException(400, "文件名不正确")
    extension = name.rsplit(".", 1)[-1].lower()
    if extension not in EXTENSIONS:
        raise HTTPException(400, "不支持此文件格式")
    file_id = str(uuid4())
    path = settings().data_dir / "files" / file_id
    size, digest = 0, hashlib.sha256()
    try:
        with path.open("xb") as handle:
            path.chmod(0o600)
            while data := await file.read(1024 * 1024):
                size += len(data)
                if size > settings().max_file_bytes:
                    raise HTTPException(413, "单文件不能超过 20 MB")
                digest.update(data)
                handle.write(data)
        if not size:
            raise HTTPException(400, "文件为空")
        existing = db.scalar(
            select(File)
            .where(
                File.kb_id == id,
                File.sha256 == digest.hexdigest(),
                File.options_hash
                == hashlib.sha256(json.dumps(parsed.model_dump(), sort_keys=True).encode()).hexdigest(),
            )
            .limit(1)
        )
        if existing:
            raise HTTPException(409, f"相同内容与解析配置已导入：{existing.name}")
        row = File(
            id=file_id,
            kb_id=id,
            name=name,
            extension=extension,
            size=size,
            sha256=digest.hexdigest(),
            options_hash=hashlib.sha256(json.dumps(parsed.model_dump(), sort_keys=True).encode()).hexdigest(),
            options=parsed.model_dump(),
        )
        await asyncio.to_thread(persist, file_id, path)
        db.add(row)
        db.flush()
        job = new_job(db, id, "parse", [file_id])
        db.commit()
    except IntegrityError:
        db.rollback()
        path.unlink(missing_ok=True)
        raise HTTPException(409, "相同内容和解析配置的文件已经存在") from None
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    notify_job(job.id)
    return {"file": file_dict(row, db), "task": job_dict(job)}


@app.post("/api/v1/knowledge/{id}/build")
def build(id: str, body: dict, db: DB, role: Role):
    managed(role)
    get_kb(db, id, role)
    guard_reindex(db, id)
    if db.scalar(select(Job.id).where(Job.kb_id == id, Job.status.in_(["queued", "running"])).limit(1)):
        raise HTTPException(409, "知识库已有待处理任务，请完成后再构建")
    ids = body.get("fileIds", [])
    if not isinstance(ids, list) or not ids or len(ids) > 100:
        raise HTTPException(400, "请选择 1–100 份待构建文件")
    for file_id in ids:
        file = db.get(File, file_id)
        if (
            not file
            or file.kb_id != id
            or not file.blocks
            or not (
                file.status in {"preview", "failed"}
                or (file.status == "ready" and file.preparation.get("needsRebuild"))
            )
        ):
            raise HTTPException(400, "仅可构建已经解析完成的文件")
    job = new_job(db, id, "build", list(dict.fromkeys(ids)))
    for file_id in ids:
        row = db.get(File, file_id)
        if not row.activated:
            row.status = "queued"
    db.commit()
    notify_job(job.id)
    return job_dict(job)


def guard_reindex(db, kb_id):
    if db.scalar(
        select(Job.id)
        .where(Job.kb_id == kb_id, Job.kind == "reindex", Job.status.in_(["queued", "running"]))
        .limit(1)
    ):
        raise HTTPException(409, "正在重建知识库索引，请完成后再修改文件")


def require_file(db, id, role):
    file = db.get(File, id)
    if not file:
        raise HTTPException(404, "文件不存在")
    get_kb(db, file.kb_id, role)
    if role == "user" and file.status != "ready":
        raise HTTPException(404, "此文件不可查看")
    return file


@app.get("/api/v1/files/{id}/download")
def download(id: str, db: DB, role: Role):
    file = require_file(db, id, role)
    if not file_path(file).exists():
        raise HTTPException(404, "原文件不存在")
    if settings().storage_backend == "vercel_blob":
        from urllib.parse import quote

        path = file_path(file)

        def chunks():
            with path.open("rb") as handle:
                while data := handle.read(65536):
                    yield data

        return StreamingResponse(
            chunks(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''" + quote(file.name),
            },
        )
    return FileResponse(file_path(file), filename=file.name, media_type="application/octet-stream")


@app.get("/api/v1/files/{id}/chunks")
def chunks(id: str, db: DB, role: Role):
    file = require_file(db, id, role)
    get_kb(db, file.kb_id, role)
    rows = list(
        db.scalars(select(Chunk).where(Chunk.file_id == id, Chunk.generation == file.index_generation))
    )
    rows.sort(key=lambda chunk: chunk.metadata_json.get("order", 0))
    return [
        {"id": c.id, "text": c.content, "location": c.location, "metadata": c.metadata_json} for c in rows
    ]


@app.patch("/api/v1/chunks/{id}")
def edit_chunk(id: str, body: dict, db: DB, role: Role):
    managed(role)
    chunk = db.get(Chunk, id)
    if not chunk:
        raise HTTPException(404, "知识片段不存在")
    kb = get_kb(db, chunk.kb_id, role)
    content = body.get("text", "")
    if not isinstance(content, str) or not content.strip() or len(content) > 16000:
        raise HTTPException(400, "片段内容须为 1–16,000 字符")
    guard_reindex(db, kb.id)
    if chunk.generation != db.get(File, chunk.file_id).index_generation:
        raise HTTPException(409, "片段已被新索引替换，请刷新后编辑")
    file = db.get(File, chunk.file_id)
    if db.scalar(select(Job.id).where(Job.kb_id == kb.id, Job.status.in_(["queued", "running"])).limit(1)):
        raise HTTPException(409, "知识库有处理中的任务，请完成后再编辑")
    prepared = file.preparation.get("documents")
    if prepared:
        import copy

        documents = copy.deepcopy(prepared)
        order = chunk.metadata_json.get("order", 0)
        if order >= len(documents) or documents[order]["text"] != chunk.content:
            raise HTTPException(409, "片段已变化，请刷新后编辑")
        documents[order]["text"] = content
        metadata = documents[order]["metadata"]
        metadata["edited"] = True
        if metadata.get("parentText"):
            metadata["parentText"] = metadata["parentText"].replace(chunk.content, content, 1)
        edits = [
            *file.preparation.get("chunkEdits", []),
            {
                "order": order,
                "before": chunk.content,
                "after": content,
                "role": role,
                "date": utcnow().isoformat(),
            },
        ]
        file.preparation = {
            **file.preparation,
            "documents": documents,
            "chunkEdits": edits[-100:],
            "needsRebuild": True,
        }
    else:
        blocks = [dict(item) for item in file.blocks]
        block_index = chunk.metadata_json.get("block_index", 0)
        if block_index >= len(blocks):
            raise HTTPException(409, "片段位置已变化，请刷新")
        original = blocks[block_index]["text"]
        offset = chunk.metadata_json.get("start_index", -1)
        if offset < 0 or original[offset : offset + len(chunk.content)] != chunk.content:
            offset = original.find(chunk.content)
        if offset < 0:
            raise HTTPException(409, "原始内容已变化，请刷新片段")
        blocks[block_index]["text"] = original[:offset] + content + original[offset + len(chunk.content) :]
        file.blocks = blocks
        file.preparation = {**file.preparation, "needsRebuild": True}
    job = new_job(db, kb.id, "build", [file.id])
    file.updated, kb.updated = utcnow(), utcnow()
    db.commit()
    notify_job(job.id)
    return {"updated": False, "queued": True, "task": job_dict(job)}


@app.patch("/api/v1/files/{id}")
def file_status(id: str, body: dict, db: DB, role: Role):
    managed(role)
    file = require_file(db, id, role)
    guard_reindex(db, file.kb_id)
    if file.status in {"queued", "parsing", "indexing"}:
        raise HTTPException(409, "文件正在处理，请稍后修改")
    if body.get("action") == "disable":
        file.status = "disabled"
    elif body.get("action") == "enable":
        get_kb(db, file.kb_id, role)
        has_index = db.scalar(
            select(Chunk.id).where(Chunk.file_id == id, Chunk.generation == file.index_generation).limit(1)
        )
        file.status = "ready" if has_index else "preview" if file.blocks else "failed"
    else:
        raise HTTPException(400, "未知文件操作")
    file.updated = utcnow()
    db.commit()
    return file_dict(file, db)


@app.delete("/api/v1/files/{id}")
def remove_file(id: str, db: DB, role: Role):
    managed(role)
    file = require_file(db, id, role)
    guard_reindex(db, file.kb_id)
    if file.status in {"queued", "parsing", "indexing"}:
        raise HTTPException(409, "文件正在处理，请稍后删除")
    db.delete(file)
    db.commit()
    remove_original(file)
    return {"deleted": True}


@app.post("/api/v1/tasks/{id}/retry")
def retry(id: str, db: DB, role: Role):
    managed(role)
    job = db.get(Job, id)
    if not job:
        raise HTTPException(404, "任务不存在")
    get_kb(db, job.kb_id, role)
    if job.status != "failed":
        raise HTTPException(409, "仅可重试失败任务")
    guard_reindex(db, job.kb_id)
    if job.kind == "reindex" and db.scalar(
        select(Job.id).where(Job.kb_id == job.kb_id, Job.status.in_(["queued", "running"])).limit(1)
    ):
        raise HTTPException(409, "知识库有待处理任务，请完成后再重试重建")
    ids = (
        [
            id
            for id in job.file_ids
            if db.get(File, id) and (db.get(File, id).status == "failed" or db.get(File, id).error)
        ]
        if job.kind != "reindex"
        else job.file_ids
    )
    if not ids:
        raise HTTPException(400, "没有可重试的失败文件")
    claimed = db.execute(update(Job).where(Job.id == id, Job.status == "failed").values(status="retried"))
    if not claimed.rowcount:
        raise HTTPException(409, "重试已提交")
    created = new_job(
        db,
        job.kb_id,
        job.kind,
        ids,
        {
            k: v
            for k, v in job.options.items()
            if k not in {"completed", "indexProgress", "questionProgress", "errors"}
        },
    )
    if job.kind != "reindex":
        for file_id in ids:
            db.get(File, file_id).status = "queued"

    db.commit()
    notify_job(created.id)
    return job_dict(created)


@app.put("/api/v1/settings/ocr")
def set_ocr(body: OCRInput, db: DB, role: Role):
    admin(role)
    row = db.get(Setting, "ocr")
    value = dict(row.value) if row else {}
    if body.accessKeyId:
        value["id_secret"] = encrypt(body.accessKeyId)
    if body.accessKeySecret:
        value["key_secret"] = encrypt(body.accessKeySecret)
    if body.enabled and not (value.get("id_secret") and value.get("key_secret")):
        raise HTTPException(400, "请先配置 AccessKey ID 与 Secret")
    value.update(enabled=body.enabled, region=body.region)
    if row:
        row.value = value
    else:
        db.add(Setting(key="ocr", value=value))
    db.commit()
    return {"enabled": body.enabled, "region": body.region, "hasKey": bool(value.get("key_secret"))}


@app.post("/api/v1/retrieval")
def retrieve(body: RetrievalInput, db: DB, role: Role):
    retriever = KnowledgeRetriever(
        db=db,
        kb_ids=body.kbIds,
        role=role,
        top_k=body.topK,
        threshold=body.threshold,
        use_rerank=body.rerank,
        current_only=body.currentOnly,
        metadata_filters=[item.model_dump() for item in body.metadataFilters],
    )
    docs = retriever.invoke(body.question)
    return {
        "sources": [as_source(d) for d in docs],
        "stages": retriever.stages,
        "calls": retriever.calls,
        "warnings": retriever.warnings,
    }


@app.post("/api/v1/chat")
def chat(body: ChatInput, request: Request, db: DB, role: Role, browser: Browser):
    return start_chat(body, request, db, role, browser)


def start_chat(body, request, db, role, browser, app_context=None):
    for id in body.kbIds:
        get_kb(db, id, role)
    model = db.get(Model, body.modelId)
    if not model or model.type != "LLM" or model.status != "ready":
        raise HTTPException(400, "请先配置并测试对话模型")
    if body.conversationId:
        conversation = db.get(Conversation, body.conversationId)
        if not conversation or conversation.browser_id != browser or conversation.role != role:
            raise HTTPException(404, "对话不存在")
        if conversation.application_id != (app_context["id"] if app_context else None):
            raise HTTPException(409, "请使用此会话所属的应用入口")
        if app_context and conversation.application_revision != app_context["revision"]:
            raise HTTPException(409, "应用已更新发布版本，请开启新对话")
        if set(conversation.kb_ids) != set(body.kbIds):
            raise HTTPException(409, "同一会话不能更换知识库，请新建对话")
    else:
        conversation = Conversation(
            id=str(uuid4()),
            browser_id=browser,
            role=role,
            title=body.question[:60],
            kb_ids=body.kbIds,
            messages=[],
            application_id=app_context["id"] if app_context else None,
            application_revision=app_context["revision"] if app_context else None,
        )
        db.add(conversation)
        db.flush()
    previous = list(conversation.messages)
    if previous and previous[-1].get("pendingUntil", 0) > time.time():
        raise HTTPException(409, "当前对话正在生成，请停止或完成后再发送")
    turn_id = str(uuid4())
    claimed = db.execute(
        update(Conversation)
        .where(Conversation.id == conversation.id, Conversation.messages == previous)
        .values(
            messages=[
                *previous,
                {
                    "id": turn_id,
                    "kind": "user",
                    "text": body.question,
                    "sources": [],
                    "pendingUntil": time.time() + 3600,
                },
            ]
        )
        .execution_options(synchronize_session=False)
    )
    if not claimed.rowcount:
        raise HTTPException(409, "对话已更新，请刷新后重试")
    db.commit()
    return StreamingResponse(
        stream_chat(body, role, browser, conversation.id, request, turn_id, app_context),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-store", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/v1/conversations/{id}")
def delete_conversation(id: str, db: DB, role: Role, browser: Browser):
    row = db.get(Conversation, id)
    if not row or row.role != role or row.browser_id != browser:
        raise HTTPException(404, "对话不存在")
    db.delete(row)
    db.commit()
    return {"deleted": True}


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "接口不存在")
    root = settings().frontend_dist.resolve()
    target = (root / path).resolve()
    if target.is_relative_to(root) and target.is_file():
        return FileResponse(target)
    if (root / "index.html").exists():
        return FileResponse(root / "index.html")
    raise HTTPException(404, "请先构建前端：cd frontend && npm run build")
