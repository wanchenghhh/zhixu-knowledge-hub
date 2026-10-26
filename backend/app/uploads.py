"""Small authenticated chunks keep 20 MB uploads below function payload limits."""

import asyncio
import hashlib
import json
import math
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import File, Job, session_factory
from .jobs import new_job
from .schemas import ParseOptions
from .security import get_kb, managed, role_header
from .serialize import file_dict, job_dict
from .storage import PART_BYTES, put_part, finish_parts, cleanup_parts
from .tasks import notify_job

router = APIRouter(prefix="/api/v1")


def database():
    with session_factory()() as db:
        yield db


class UploadStart(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    size: int = Field(gt=0, le=20 * 1024 * 1024)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    options: ParseOptions = Field(default_factory=ParseOptions)
    consent: bool = False


@router.post("/knowledge/{kb_id}/uploads")
def start(kb_id: str, body: UploadStart, db=Depends(database), role=Depends(role_header)):
    from .main import guard_reindex
    from .documents import EXTENSIONS

    managed(role)
    get_kb(db, kb_id, role)
    guard_reindex(db, kb_id)
    name = body.name.replace("\\", "/").split("/")[-1]
    ext = name.rsplit(".", 1)[-1].lower()
    if not body.consent or ext not in EXTENSIONS or any(ord(c) < 32 for c in name):
        raise HTTPException(400, "请确认云端解析提示并选择支持的文件格式")
    options = body.options.model_dump()
    if options["overlap"] >= options["chunkSize"]:
        raise HTTPException(400, "重叠长度必须小于分块长度")
    options_hash = hashlib.sha256(json.dumps(options, sort_keys=True).encode()).hexdigest()
    existing = db.scalar(
        select(File).where(File.kb_id == kb_id, File.sha256 == body.sha256, File.options_hash == options_hash)
    )
    if existing:
        if existing.status == "uploading":
            return {
                "id": existing.id,
                "partBytes": PART_BYTES,
                "received": list(existing.cloud_jobs["upload"]["received"]),
            }
        raise HTTPException(409, f"相同内容与解析配置已导入：{existing.name}")
    row = File(
        id=str(uuid4()),
        kb_id=kb_id,
        name=name,
        extension=ext,
        size=body.size,
        sha256=body.sha256,
        options_hash=options_hash,
        options=options,
        status="uploading",
        cloud_jobs={"upload": {"count": math.ceil(body.size / PART_BYTES), "received": {}}},
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "相同文件正在上传，请稍后重试") from None
    return {"id": row.id, "partBytes": PART_BYTES, "received": []}


def upload_file(db, id, role):
    managed(role)
    file = db.get(File, id)
    if not file:
        raise HTTPException(404, "文件不存在")
    get_kb(db, file.kb_id, role)
    return file


@router.post("/files/{id}/parts/{index}")
async def part(id: str, index: int, request: Request, db=Depends(database), role=Depends(role_header)):
    file = upload_file(db, id, role)
    upload = file.cloud_jobs.get("upload", {})
    if file.status != "uploading" or index < 0 or index >= upload.get("count", 0):
        raise HTTPException(409, "上传状态或分片序号不正确")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > PART_BYTES:
            raise HTTPException(413, "上传分片超过 2 MB")
    expected = min(PART_BYTES, file.size - index * PART_BYTES)
    if len(data) != expected:
        raise HTTPException(400, "上传分片大小不正确")
    await asyncio.to_thread(put_part, id, index, bytes(data))
    received = {**upload.get("received", {}), str(index): hashlib.sha256(data).hexdigest()}
    file.cloud_jobs = {**file.cloud_jobs, "upload": {**upload, "received": received}}
    db.commit()
    return {"received": index}


@router.post("/files/{id}/complete-upload")
def complete(id: str, db=Depends(database), role=Depends(role_header)):
    file = upload_file(db, id, role)
    if file.status != "uploading":
        job = db.scalar(
            select(Job).where(Job.kb_id == file.kb_id, Job.kind == "parse").order_by(Job.created.desc())
        )
        if job and file.id in job.file_ids:
            return {"file": file_dict(file, db), "task": job_dict(job)}
        raise HTTPException(409, "文件已经提交")
    finish_parts(file)
    file.status = "queued"
    job = new_job(db, file.kb_id, "parse", [file.id])
    db.commit()
    cleanup_parts(file)
    notify_job(job.id)
    return {"file": file_dict(file, db), "task": job_dict(job)}
