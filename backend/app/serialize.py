from datetime import timezone
from zoneinfo import ZoneInfo
from sqlalchemy import func, select
from .config import settings
from .db import (
    Application,
    ApplicationRun,
    Chunk,
    Conversation,
    File,
    Job,
    Knowledge,
    Model,
    QueryLog,
    Setting,
)


def date(value):
    return value.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M")


def model_dict(m):
    return {
        "id": m.id,
        "name": m.name,
        "provider": m.provider,
        "type": m.type,
        "model": m.model,
        "url": m.url,
        "dimension": m.dimension,
        "timeout": m.timeout,
        "status": m.status,
        "hasKey": bool(m.secret),
        "error": m.error,
    }


def kb_dict(k):
    return {
        "id": k.id,
        "name": k.name,
        "description": k.description,
        "category": k.category,
        "color": "purple",
        "icon": "folder",
        "visible": k.visible,
        "embedding": k.embedding,
        "rerankModel": k.rerank_model,
        "rerank": k.rerank,
        "topK": k.top_k,
        "threshold": k.threshold,
        "prompt": k.prompt,
        "updated": date(k.updated),
    }


def file_dict(f, db):
    count = db.scalar(
        select(func.count())
        .select_from(Chunk)
        .join(Knowledge, Knowledge.id == Chunk.kb_id)
        .where(Chunk.file_id == f.id, Chunk.generation == f.index_generation)
    )
    return {
        "id": f.id,
        "kbId": f.kb_id,
        "name": f.name,
        "size": f"{f.size / 1024:.1f} KB" if f.size < 1024 * 1024 else f"{f.size / 1024 / 1024:.1f} MB",
        "type": "WORD"
        if f.extension in {"doc", "docx"}
        else "EXCEL"
        if f.extension in {"xls", "xlsx", "csv"}
        else "IMAGE"
        if f.extension in {"png", "jpg", "jpeg"}
        else f.extension.upper(),
        "status": f.status,
        "content": "\n\n".join(b["text"] for b in f.blocks)[:16000],
        "location": f.blocks[0]["location"] if f.blocks else "待解析",
        "updated": date(f.updated),
        "error": f.error,
        "chunkCount": count,
        "options": f.options,
        "metadata": f.metadata_values,
        "version": f.version_label,
        "documentGroup": f.document_group,
        "effectiveOn": f.effective_on,
        "preparedCount": len(f.preparation.get("documents", [])),
        "preview": f.blocks[:100] if f.status == "preview" else [],
        "previewTruncated": len(f.blocks) > 100,
    }


def job_dict(j):
    return {
        "id": j.id,
        "kbId": j.kb_id,
        "name": {
            "parse": "文档解析与抽取",
            "prepare": "文档预处理",
            "build": "知识构建",
            "reindex": "重建索引",
        }.get(j.kind, j.kind),
        "status": j.status,
        "kind": j.kind,
        "stage": j.stage,
        "total": len(j.file_ids),
        "finished": j.finished,
        "date": date(j.created),
        "fileIds": j.file_ids,
        "error": j.error,
        "usage": j.usage,
    }


def log_dict(log):
    return {
        "id": log.id,
        "applicationId": log.application_id,
        "role": log.role,
        "kbIds": log.kb_ids,
        "question": log.question,
        "answer": log.answer,
        "status": log.status,
        "tokens": log.tokens,
        "duration": log.duration,
        "model": log.model,
        "date": date(log.created),
        "sources": log.sources,
        "error": log.error,
        "details": log.details,
    }


def state_dict(db, role, browser_id):
    kbs = [
        k
        for k in db.scalars(select(Knowledge).order_by(Knowledge.updated.desc()))
        if role == "admin" or role in k.visible
    ]
    ids = {k.id for k in kbs}
    files = (
        list(db.scalars(select(File).where(File.kb_id.in_(ids)).order_by(File.updated.desc()))) if ids else []
    )
    ready_ids = {f.id for f in files if f.status == "ready"}
    logs = (
        []
        if role == "user"
        else [
            log_dict(log)
            for log in db.scalars(select(QueryLog).order_by(QueryLog.created.desc()).limit(1000))
            if role == "admin" or all(id in ids for id in log.kb_ids)
        ]
    )
    sessions = []
    for s in db.scalars(
        select(Conversation)
        .where(
            Conversation.role == role,
            Conversation.browser_id == browser_id,
            Conversation.application_id.is_(None),
        )
        .order_by(Conversation.created.desc())
        .limit(200)
    ):
        if not all(id in ids for id in s.kb_ids):
            continue
        messages = []
        for m in s.messages:
            if any(
                source["fileId"] not in ready_ids
                for source in [{"fileId": id} for id in m.get("sourceFileIds", [])] + m.get("sources", [])
            ):
                messages.append(
                    {**m, "text": "引用资料已停用、删除或不可见，历史回答已隐藏。", "sources": []}
                )
            else:
                messages.append(m)
        sessions.append(
            {
                "id": s.id,
                "role": s.role,
                "title": s.title,
                "kbIds": s.kb_ids,
                "messages": messages,
                "date": date(s.created),
            }
        )
    report_tasks = []
    if role != "user":
        for run in db.scalars(
            select(ApplicationRun)
            .where(ApplicationRun.role == role, ApplicationRun.browser_id == browser_id)
            .order_by(ApplicationRun.created.desc())
            .limit(100)
        ):
            application = db.get(Application, run.application_id)
            configuration = (
                (application.draft if run.config.get("_preview") else application.published)
                if application
                else None
            )
            if (
                not configuration
                or (role != "admin" and role not in configuration["visible"])
                or not all(id in ids for id in run.config["kbIds"])
            ):
                continue
            report_tasks.append(
                {
                    "id": run.id,
                    "applicationId": run.application_id,
                    "kbId": run.config["kbIds"][0],
                    "name": run.config["name"] + " · 报告生成",
                    "status": run.status,
                    "kind": "report",
                    "stage": run.stage,
                    "total": max(1, len(run.outline)),
                    "finished": len(run.sections),
                    "date": date(run.created),
                    "fileIds": [],
                    "error": run.error,
                    "usage": run.usage,
                }
            )
    ocr = db.get(Setting, "ocr")
    return {
        "version": 1,
        "runtime": {
            "uploadStrategy": "chunked" if settings().storage_backend == "vercel_blob" else "multipart",
            "maxFileBytes": settings().max_file_bytes,
            "features": ["metadata", "smart-chunking", "versions", "applications", "reports"],
        },
        "role": role,
        "knowledge": [kb_dict(k) for k in kbs],
        "files": [file_dict(f, db) for f in files],
        "models": [model_dict(m) for m in db.scalars(select(Model).order_by(Model.updated))],
        "tasks": [
            *report_tasks,
            *[
                job_dict(j)
                for j in db.scalars(
                    select(Job).where(Job.kb_id.in_(ids)).order_by(Job.created.desc()).limit(500)
                )
            ],
        ]
        if role != "user"
        else [],
        "sessions": sessions,
        "logs": logs,
        "ocr": {
            "provider": "阿里云 DocMind",
            "region": "cn-hangzhou",
            "enabled": bool(ocr and ocr.value.get("enabled")),
            "hasKey": bool(ocr and ocr.value.get("key_secret")),
        },
    }
