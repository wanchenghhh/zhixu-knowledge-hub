"""Knowledge processing controls; changes take effect through staged index builds."""

import hashlib
import json
import re
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from pydantic import BaseModel, Field
from .db import File, Job, session_factory, utcnow
from .processing import DEFAULT_FIELDS, field_schema, metadata_value, resolve_llm
from .schemas import ParseOptions, ProcessingConfig
from .security import managed, get_kb, role_header
from .jobs import new_job
from .tasks import notify_job
from .serialize import file_dict, job_dict
from .versions import current_files

router = APIRouter(prefix="/api/v1")


def database():
    with session_factory()() as db:
        yield db


def require_file(db, id, role, write=False):
    if write:
        managed(role)
    file = db.scalar(select(File).where(File.id == id).with_for_update()) if write else db.get(File, id)
    if not file:
        raise HTTPException(404, "文件不存在")
    get_kb(db, file.kb_id, role)
    if write and db.scalar(
        select(Job.id).where(Job.kb_id == file.kb_id, Job.status.in_(["queued", "running"])).limit(1)
    ):
        raise HTTPException(409, "此知识库有处理中的任务，请完成后再修改")
    return file


def config_dict(kb):
    return {
        "options": ParseOptions.model_validate(kb.processing_config.get("options", {})).model_dump(),
        "fields": field_schema(kb),
    }


@router.get("/knowledge/{id}/processing")
def get_processing(id: str, db=Depends(database), role=Depends(role_header)):
    managed(role)
    return config_dict(get_kb(db, id, role))


@router.put("/knowledge/{id}/processing")
def set_processing(id: str, body: ProcessingConfig, db=Depends(database), role=Depends(role_header)):
    managed(role)
    kb = get_kb(db, id, role)
    if body.options.extractMetadata or (
        body.options.strategy == "qa" and body.options.questionMode == "extract"
    ):
        resolve_llm(db, body.options.extractionModel)
    if db.scalar(select(Job.id).where(Job.kb_id == id, Job.status.in_(["queued", "running"])).limit(1)):
        raise HTTPException(409, "知识库正在处理任务，请完成后再修改默认方案")
    data = body.model_dump()
    data["fields"] = data["fields"] or DEFAULT_FIELDS
    kb.processing_config = data
    kb.updated = utcnow()
    db.commit()
    return config_dict(kb)


@router.get("/files/{id}/detail")
def detail(id: str, db=Depends(database), role=Depends(role_header)):
    file = require_file(db, id, role)
    kb = get_kb(db, file.kb_id, role)
    group = file.preparation.get("pendingVersion", {}).get("document_group", file.document_group or file.id)
    member = db.scalar(
        select(File)
        .where(File.kb_id == kb.id, File.id != file.id, File.document_group == group)
        .order_by(File.updated.desc())
        .limit(1)
    )
    title = file.metadata_values.get("title", {}).get("value")
    suggestion = None
    if title:
        for candidate in db.scalars(
            select(File).where(File.kb_id == kb.id, File.id != file.id).order_by(File.updated.desc())
        ):
            if candidate.metadata_values.get("title", {}).get("value") == title:
                suggestion = candidate.id
                break
    data = file_dict(file, db)
    data.update(
        metadata=file.metadata_values,
        fields=field_schema(kb),
        preparedCount=len(file.preparation.get("documents", [])),
        version={
            "group": file.document_group or file.id,
            "groupFileId": member.id if member else None,
            "suggestedGroupFileId": suggestion,
            "label": file.version_label,
            "effectiveOn": file.effective_on,
            "expiresOn": file.expires_on,
            "current": file.id in current_files(db, kb.id),
            "pending": file.preparation.get("pendingVersion"),
        },
        needsRebuild=bool(file.preparation.get("needsRebuild")),
        metadataEdits=file.preparation.get("metadataEdits", [])[-50:],
    )
    return data


@router.get("/files/{id}/preview")
def preview(
    id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db=Depends(database),
    role=Depends(role_header),
):
    managed(role)
    file = require_file(db, id, role)
    items = file.preparation.get("documents", [])
    return {"total": len(items), "offset": offset, "items": items[offset : offset + limit]}


@router.patch("/files/{id}/metadata")
def metadata(id: str, body: dict, db=Depends(database), role=Depends(role_header)):
    file = require_file(db, id, role, True)
    kb = get_kb(db, file.kb_id, role)
    values = body.get("values")
    if not isinstance(values, dict):
        raise HTTPException(400, "请提供字段值")
    definitions = {f["id"]: f for f in field_schema(kb) if f["enabled"]}
    if any(key not in definitions for key in values):
        raise HTTPException(400, "包含未知或未启用字段")
    updated = dict(file.metadata_values)
    edits = list(file.preparation.get("metadataEdits", []))
    for key, value in values.items():
        try:
            clean = metadata_value(value, definitions[key])
        except (ValueError, TypeError):
            raise HTTPException(400, f"{definitions[key]['name']} 的值与字段类型不符") from None
        before = updated.get(key, {})
        if before.get("value") == clean:
            continue
        edits.append(
            {
                "field": key,
                "before": before.get("value"),
                "after": clean,
                "role": role,
                "date": utcnow().isoformat(),
            }
        )
        updated[key] = {**before, "value": clean, "manual": True, "source": "manual"}
    file.metadata_values = updated
    file.preparation = {**file.preparation, "metadataEdits": edits[-100:], "needsRebuild": True}
    file.updated = utcnow()
    db.commit()
    return {"metadata": updated, "needsRebuild": True}


class PrepareInput(BaseModel):
    options: ParseOptions
    reextract: bool = False


@router.post("/files/{id}/prepare")
def prepare(id: str, body: PrepareInput, db=Depends(database), role=Depends(role_header)):
    file = require_file(db, id, role, True)
    kb = get_kb(db, file.kb_id, role)
    if not file.blocks:
        raise HTTPException(400, "请先完成原文件解析")
    if body.options.extractMetadata or (
        body.options.strategy == "qa" and body.options.questionMode == "extract"
    ):
        resolve_llm(db, body.options.extractionModel)
    old = file.preparation
    state = {k: v for k, v in old.items() if k in {"pendingVersion", "metadataEdits", "questions"}}
    schema_hash = hashlib.sha256(json.dumps(field_schema(kb), sort_keys=True).encode()).hexdigest()
    if (
        not body.reextract
        and old.get("metadataDone")
        and old.get("schemaHash") == schema_hash
        and file.options.get("extractionModel") == body.options.extractionModel
    ):
        state.update(metadataDone=True, schemaHash=schema_hash)
    else:
        file.metadata_values = {k: v for k, v in file.metadata_values.items() if v.get("manual")}
    file.options = body.options.model_dump()
    file.preparation = {**state, "needsRebuild": True}
    if not file.activated:
        file.status = "queued"
    job = new_job(db, kb.id, "prepare", [file.id])
    db.commit()
    notify_job(job.id)
    return {"task": job_dict(job)}


class VersionInput(BaseModel):
    groupFileId: str | None = None
    label: str = Field(default="", max_length=100)
    effectiveOn: str = ""
    expiresOn: str = ""

    def dates(self):
        try:
            for value in [self.effectiveOn, self.expiresOn]:
                if value:
                    date.fromisoformat(value)
            if self.expiresOn and self.effectiveOn and self.expiresOn < self.effectiveOn:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, "请使用有效的日期范围 YYYY-MM-DD") from None


@router.put("/files/{id}/version")
def set_version(id: str, body: VersionInput, db=Depends(database), role=Depends(role_header)):
    file = require_file(db, id, role, True)
    body.dates()
    group = file.id
    if body.groupFileId:
        other = require_file(db, body.groupFileId, role)
        if other.kb_id != file.kb_id:
            raise HTTPException(400, "只能关联同一知识库中的文档版本")
        group = other.document_group or other.id
    file.preparation = {
        **file.preparation,
        "pendingVersion": {
            "document_group": group,
            "version_label": body.label,
            "effective_on": body.effectiveOn,
            "expires_on": body.expiresOn,
        },
        "needsRebuild": True,
    }
    db.commit()
    return {"pendingVersion": file.preparation["pendingVersion"]}


@router.get("/knowledge/{id}/versions")
def versions(id: str, db=Depends(database), role=Depends(role_header)):
    get_kb(db, id, role)
    active = current_files(db, id)

    def title(row):
        return row.metadata_values.get("title", {}).get("value") or re.sub(
            r"[-_ ]?[vV]?\d+(?:\.\d+)+", "", row.name.rsplit(".", 1)[0]
        )

    return [
        {
            "id": f.id,
            "name": f.name,
            "title": title(f),
            "group": f.document_group or f.id,
            "label": f.version_label,
            "effectiveOn": f.effective_on,
            "expiresOn": f.expires_on,
            "current": f.id in active,
            "status": f.status,
            "activated": f.activated.isoformat() if f.activated else None,
        }
        for f in db.scalars(select(File).where(File.kb_id == id).order_by(File.updated.desc()))
    ]


@router.get("/tasks/{id}")
def task_detail(id: str, db=Depends(database), role=Depends(role_header)):
    managed(role)
    job = db.get(Job, id)
    if not job:
        raise HTTPException(404, "任务不存在")
    get_kb(db, job.kb_id, role)
    return job_dict(job)
