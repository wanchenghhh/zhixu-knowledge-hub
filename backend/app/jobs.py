"""Database-backed jobs are the source of truth; Celery delivery is recoverable."""

import logging
import threading
from datetime import timedelta
from uuid import uuid4
import jieba
from sqlalchemy import delete, select, update
from .config import settings
from .db import Chunk, File, Job, Knowledge, Model, session_factory, utcnow
from .documents import parse_file, split_blocks
from .providers import CloudEmbeddings
from .security import safe_error


def terms(text: str):
    return [
        word.lower().strip()
        for word in jieba.lcut(text)
        if word.strip() and (word.isalnum() or any("\u4e00" <= c <= "\u9fff" for c in word))
    ]


def new_job(db, kb_id, kind, files, options=None):
    job = Job(id=str(uuid4()), kb_id=kb_id, kind=kind, file_ids=list(files), options=options or {})
    db.add(job)
    db.flush()
    return job


def index_documents(db, kb, file, model, generation, options, job=None):
    documents = split_blocks(file.blocks, options)
    if not documents:
        raise ValueError("文档未提取到可用文字")

    def heartbeat():
        job.touched = utcnow()
        db.commit()

    adapter = CloudEmbeddings(model, heartbeat=heartbeat if job else None)
    vectors = adapter.embed_documents([doc.page_content for doc in documents])
    db.execute(delete(Chunk).where(Chunk.file_id == file.id, Chunk.generation == generation))
    for order, (doc, vector) in enumerate(zip(documents, vectors, strict=True)):
        db.add(
            Chunk(
                id=str(uuid4()),
                kb_id=kb.id,
                file_id=file.id,
                generation=generation,
                content=doc.page_content,
                location=doc.metadata["location"],
                metadata_json={**doc.metadata, "order": order},
                terms=" ".join(terms(doc.page_content)),
                embedding=vector,
            )
        )
    return adapter.usage


def run_job(job_id):
    factory = session_factory()
    with factory() as db:
        claimed = db.execute(
            update(Job)
            .where(Job.id == job_id, Job.status == "queued")
            .values(status="running", touched=utcnow())
        )
        db.commit()
        if not claimed.rowcount:
            return
        job = db.get(Job, job_id)
        kb = db.get(Knowledge, job.kb_id)
        if not kb:
            return
        errors = []
        calls = list(job.usage.get("calls", []))
        completed = list(job.options.get("completed", []))
        job.finished = len(completed)
        db.commit()
        generation = job.options.get("generation", kb.generation)
        model_id = job.options.get("modelId", kb.embedding)
        for file_id in job.file_ids:
            if file_id in completed:
                continue
            file = db.get(File, file_id)
            if not file or file.kb_id != kb.id:
                errors.append("文件已被删除")
                continue
            try:
                job.touched = utcnow()
                job.stage = "解析中" if job.kind == "parse" else "向量化中"
                if job.kind != "reindex":
                    file.status = "parsing" if job.kind == "parse" else "indexing"
                file.error = None
                db.commit()
                if job.kind == "parse":
                    file.blocks = parse_file(file, db, job)
                    if not file.blocks:
                        raise ValueError("未识别到文字，请检查文档内容或使用增强解析")
                    # Validate splitting at preview time; it must be safe before billing embeddings.
                    split_blocks(file.blocks, file.options)
                    file.status = "preview"
                else:
                    model = db.get(Model, model_id)
                    if not model or model.type != "Embedding" or model.status != "ready":
                        raise ValueError("请先配置并测试可用的向量模型")
                    calls.extend(index_documents(db, kb, file, model, generation, file.options, job))
                    if job.kind != "reindex":
                        file.status = "ready"
                file.updated = utcnow()
                completed.append(file_id)
                job.options = {**job.options, "completed": completed}
                job.finished = len(completed)
                job.touched = utcnow()
                job.usage = {"calls": calls}
                db.commit()
            except Exception as exc:
                db.rollback()
                job, file = db.get(Job, job_id), db.get(File, file_id)
                error = safe_error(exc)
                errors.append(f"{file.name if file else file_id}：{error}")
                if file:
                    if job.kind != "reindex":
                        file.status = "failed"
                    file.error = error
                db.commit()
        job = db.get(Job, job_id)
        kb = db.get(Knowledge, job.kb_id)
        if job.kind == "reindex":
            if errors:
                db.execute(delete(Chunk).where(Chunk.kb_id == job.kb_id, Chunk.generation == generation))
            else:
                kb.embedding, kb.generation = model_id, generation
                kb.updated = utcnow()
                # The atomic pointer changes only after every document was indexed successfully.
                db.flush()
                db.execute(delete(Chunk).where(Chunk.kb_id == kb.id, Chunk.generation != generation))
        if kb:
            kb.updated = utcnow()
        job.status = "failed" if errors else "success"
        job.error = "\n".join(errors) or None
        job.stage = "部分失败" if errors and job.finished else "失败" if errors else "已完成"
        job.touched = utcnow()
        job.usage = {"calls": calls}
        db.commit()


def pending_jobs():
    with session_factory()() as db:
        stale = utcnow() - timedelta(seconds=settings().lease_seconds)
        db.execute(
            update(Job)
            .where(Job.status == "running", Job.touched < stale)
            .values(status="queued", stage="恢复排队")
        )
        db.commit()
        return list(db.scalars(select(Job.id).where(Job.status == "queued").order_by(Job.created).limit(20)))


def local_worker(stop: threading.Event):
    while not stop.is_set():
        try:
            for job_id in pending_jobs():
                if stop.is_set():
                    break
                run_job(job_id)
        except Exception as exc:
            # Jobs remain in the database if connection/dispatch fails.
            logging.getLogger(__name__).error(
                "Job dispatch failed (%s); database queue retained", type(exc).__name__
            )
        stop.wait(1)
