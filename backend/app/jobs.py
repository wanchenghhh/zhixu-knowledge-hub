"""Database-backed jobs are the source of truth; Celery delivery is recoverable."""

import logging
import threading
import time
from datetime import timedelta
from uuid import uuid4
import jieba
from sqlalchemy import delete, select, update
from .config import settings
from .db import Chunk, ChunkIndex, File, Job, Knowledge, Model, session_factory, utcnow
from .documents import parse_file, split_blocks
from .providers import CloudEmbeddings
from .security import safe_error
from .deferred import DeferredJob
from .processing import prepare_file, bounded_model
from langchain_core.documents import Document


def terms(text: str):
    return [
        word.lower().strip()
        for word in jieba.lcut(text)
        if word.strip() and (word.isalnum() or any("\u4e00" <= c <= "\u9fff" for c in word))
    ]


def new_job(db, kb_id, kind, files, options=None):
    options = dict(options or {})
    if kind == "build":
        options.setdefault("generation", str(uuid4()))
    job = Job(id=str(uuid4()), kb_id=kb_id, kind=kind, file_ids=list(files), options=options or {})
    db.add(job)
    db.flush()
    return job


def index_documents(db, kb, file, model, generation, options, job=None, deadline=None):
    prepared = file.preparation.get("documents")
    documents = (
        [Document(page_content=d["text"], metadata=d["metadata"]) for d in prepared]
        if prepared
        else split_blocks(file.blocks, options)
    )
    if not documents:
        raise ValueError("文档未提取到可用文字")

    def heartbeat():
        job.touched = utcnow()
        db.commit()

    cloud_job = job is not None and settings().queue_mode == "vercel"
    progress = dict(job.options.get("indexProgress", {})) if cloud_job else {}
    offset = progress.get(file.id, 0)
    if not cloud_job or offset == 0:
        db.execute(delete(Chunk).where(Chunk.file_id == file.id, Chunk.generation == generation))
    deadline = deadline or time.monotonic() + 90
    adapter = CloudEmbeddings(bounded_model(model), heartbeat=heartbeat if job else None)
    batch_size = 10
    for start in range(offset, len(documents), batch_size):
        if cloud_job and time.monotonic() > deadline:
            raise DeferredJob("向量化中，继续构建")
        batch = documents[start : start + batch_size]
        hints = " ".join(
            str(v.get("value") or "")
            for key, v in file.metadata_values.items()
            if key in {"title", "entity", "keywords"}
        )[:1500]
        texts = [f"{hints}\n{doc.page_content}" if hints else doc.page_content for doc in batch]
        vectors = adapter.embed_documents(texts)
        rows = []
        for order, (doc, vector) in enumerate(zip(batch, vectors[: len(batch)], strict=True), start):
            row = Chunk(
                id=str(uuid4()),
                kb_id=kb.id,
                file_id=file.id,
                generation=generation,
                content=doc.page_content,
                location=doc.metadata["location"],
                metadata_json={
                    **doc.metadata,
                    "order": order,
                    "documentMetadata": file.metadata_values,
                    "version": file.preparation.get("pendingVersion", {}).get(
                        "version_label",
                        file.version_label or file.metadata_values.get("version", {}).get("value") or "",
                    ),
                    "effectiveOn": file.preparation.get("pendingVersion", {}).get(
                        "effective_on",
                        file.effective_on or file.metadata_values.get("effective", {}).get("value") or "",
                    ),
                },
                terms=" ".join(terms(doc.page_content + " " + hints)),
                embedding=vector,
            )
            db.add(row)
            rows.append(row)
        db.flush()
        if cloud_job:
            progress[file.id] = start + len(batch)
            job.options = {**job.options, "indexProgress": progress}
            job.usage = {"calls": [*job.usage.get("calls", []), *adapter.usage]}
            adapter.usage.clear()
            job.touched = utcnow()
            db.commit()
    raw_questions = file.metadata_values.get("questions", {}).get("value") or []
    questions = (
        list(dict.fromkeys(str(q)[:500] for q in raw_questions if isinstance(q, str) and q.strip()))[:60]
        if isinstance(raw_questions, list)
        else []
    )
    question_progress = dict(job.options.get("questionProgress", {})) if cloud_job else {}
    for start in range(question_progress.get(file.id, 0), len(questions), 10):
        if cloud_job and time.monotonic() > deadline:
            raise DeferredJob("继续构建辅助问题索引")
        batch = questions[start : start + 10]
        vectors = adapter.embed_documents(batch)
        for question, vector in zip(batch, vectors, strict=True):
            base = select(Chunk).where(Chunk.file_id == file.id, Chunk.generation == generation)
            if db.bind.dialect.name == "postgresql":
                best = db.scalar(base.order_by(Chunk.embedding.cosine_distance(vector)).limit(1))
            else:
                import numpy as np

                rows = list(db.scalars(base))
                matrix = np.asarray([row.embedding for row in rows], dtype=np.float32)
                query = np.asarray(vector, dtype=np.float32)
                scores = matrix.dot(query) / np.maximum(
                    1e-12, np.linalg.norm(matrix, axis=1) * np.linalg.norm(query)
                )
                best = rows[int(scores.argmax())] if rows else None
            if best:
                db.add(ChunkIndex(id=str(uuid4()), chunk_id=best.id, text=question, embedding=vector))
        if cloud_job:
            question_progress[file.id] = start + len(batch)
            job.options = {**job.options, "questionProgress": question_progress}
            job.usage = {"calls": [*job.usage.get("calls", []), *adapter.usage]}
            adapter.usage.clear()
            job.touched = utcnow()
            db.commit()
    return adapter.usage


def run_job(job_id):
    started = time.monotonic()
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
        errors = dict(job.options.get("errors", {}))
        calls = list(job.usage.get("calls", []))
        completed = list(job.options.get("completed", []))
        job.finished = len(completed)
        db.commit()
        generation = job.options.get("generation", kb.generation)
        model_id = job.options.get("modelId", kb.embedding)
        for file_id in job.file_ids:
            if file_id in completed:
                continue
            if settings().queue_mode == "vercel" and time.monotonic() - started > 90:
                job.status, job.stage, job.touched = "queued", "继续构建", utcnow()
                db.commit()
                return True
            file = db.get(File, file_id)
            if not file or file.kb_id != kb.id:
                errors[file_id] = "文件已被删除"
                job.options = {**job.options, "errors": errors}
                db.commit()
                continue
            try:
                job.touched = utcnow()
                job.stage = "解析中" if job.kind in {"parse", "prepare"} else "向量化中"
                if job.kind != "reindex" and file.activated is None:
                    file.status = "parsing" if job.kind in {"parse", "prepare"} else "indexing"
                file.error = None
                db.commit()
                if job.kind in {"parse", "prepare"}:
                    if not file.blocks:
                        file.blocks = parse_file(file, db, job)
                        db.commit()
                    if not file.blocks:
                        raise ValueError("未识别到文字，请检查文档内容或使用增强解析")
                    if "strategy" in file.options:
                        prepare_file(db, kb, file, job, started + 90)
                        calls = list(job.usage.get("calls", []))
                    else:
                        split_blocks(file.blocks, file.options)
                    if file.activated is None:
                        file.status = "preview"
                else:
                    model = db.get(Model, model_id)
                    if not model or model.type != "Embedding" or model.status != "ready":
                        raise ValueError("请先配置并测试可用的向量模型")
                    usage = index_documents(
                        db, kb, file, model, generation, file.options, job, deadline=started + 90
                    )
                    if settings().queue_mode == "vercel":
                        calls = list(job.usage.get("calls", []))
                    else:
                        calls.extend(usage)
                    if job.kind != "reindex":
                        file.status = "ready"
                        file.index_generation = generation
                        file.activated = utcnow()
                        pending = file.preparation.get("pendingVersion", {})
                        for key in ("document_group", "version_label", "effective_on", "expires_on"):
                            if key in pending:
                                setattr(file, key, pending[key])
                        if not pending:
                            file.version_label = str(
                                file.metadata_values.get("version", {}).get("value") or file.version_label
                            )
                            file.effective_on = str(
                                file.metadata_values.get("effective", {}).get("value") or file.effective_on
                            )
                        if not file.document_group:
                            file.document_group = file.id
                        file.preparation = {**file.preparation, "needsRebuild": False}
                        db.execute(
                            delete(Chunk).where(Chunk.file_id == file.id, Chunk.generation != generation)
                        )
                file.updated = utcnow()
                errors.pop(file_id, None)
                completed.append(file_id)
                job.options = {**job.options, "completed": completed, "errors": errors}
                job.finished = len(completed)
                job.touched = utcnow()
                job.usage = {"calls": calls}
                db.commit()
            except DeferredJob as exc:
                db.rollback()
                job = db.get(Job, job_id)
                job.status, job.stage, job.touched = "queued", str(exc), utcnow()
                db.commit()
                return True
            except Exception as exc:
                db.rollback()
                job, file = db.get(Job, job_id), db.get(File, file_id)
                error = safe_error(exc)
                errors[file_id] = f"{file.name if file else file_id}：{error}"
                job.options = {**job.options, "errors": errors}
                if file:
                    if job.kind != "reindex" and file.activated is None:
                        file.status = "failed"
                    file.error = error
                db.commit()
        job = db.get(Job, job_id)
        kb = db.get(Knowledge, job.kb_id)
        if job.kind == "reindex":
            if errors:
                db.execute(delete(Chunk).where(Chunk.kb_id == job.kb_id, Chunk.generation == generation))
            else:
                for file_id in job.file_ids:
                    row = db.get(File, file_id)
                    if row:
                        row.index_generation = generation
                kb.embedding, kb.generation = model_id, generation
                kb.updated = utcnow()
                # The atomic pointer changes only after every document was indexed successfully.
                db.flush()
                db.execute(delete(Chunk).where(Chunk.kb_id == kb.id, Chunk.generation != generation))
        if kb:
            kb.updated = utcnow()
        job.status = "failed" if errors else "success"
        job.error = "\n".join(errors.values()) or None
        job.stage = "部分失败" if errors and job.finished else "失败" if errors else "已完成"
        job.touched = utcnow()
        if settings().queue_mode != "vercel":
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
            from .application_jobs import pending_runs, process_run

            for run_id in pending_runs():
                if stop.is_set():
                    break
                process_run(run_id)
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
