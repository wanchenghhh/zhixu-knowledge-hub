"""Manually curated examples, retaining a snapshot after source log expiry."""

from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .db import EvaluationCase, EvaluationDataset, Knowledge, QueryLog, session_factory, utcnow
from .security import get_kb, managed, role_header
from .serialize import date

router = APIRouter(prefix="/api/v1")


def database():
    with session_factory()() as db:
        yield db


def visible(db, case, role):
    try:
        for id in case.snapshot.get("kbIds", []):
            get_kb(db, id, role)
        return True
    except HTTPException:
        return False


def dataset(db, id):
    row = db.get(EvaluationDataset, id)
    if not row:
        raise HTTPException(404, "评测集不存在")
    return row


def case_dict(row):
    return {
        "id": row.id,
        "datasetId": row.dataset_id,
        "logId": row.log_id,
        "label": row.label,
        "note": row.note,
        "expected": row.expected,
        "snapshot": row.snapshot,
        "created": date(row.created),
        "updated": date(row.updated),
    }


def dataset_dict(row, cases):
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "created": date(row.created),
        "updated": date(row.updated),
        "count": len(cases),
        "good": sum(c.label == "good" for c in cases),
        "bad": sum(c.label == "bad" for c in cases),
    }


class DatasetInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)


class CaseInput(BaseModel):
    logId: str = Field(min_length=1, max_length=36)
    label: Literal["good", "bad"]
    note: str = Field(default="", max_length=4000)
    expected: str = Field(default="", max_length=8000)


class CaseEdit(BaseModel):
    label: Literal["good", "bad"]
    note: str = Field(default="", max_length=4000)
    expected: str = Field(default="", max_length=8000)


@router.get("/evaluation-datasets")
def list_datasets(db=Depends(database), role=Depends(role_header)):
    managed(role)
    rows = list(db.scalars(select(EvaluationDataset).order_by(EvaluationDataset.updated.desc())))
    allowed = {kb.id for kb in db.scalars(select(Knowledge)) if role == "admin" or role in kb.visible}
    grouped = {row.id: [] for row in rows}
    for case in db.scalars(select(EvaluationCase)):
        if case.dataset_id in grouped and set(case.snapshot.get("kbIds", [])).issubset(allowed):
            grouped[case.dataset_id].append(case)
    return [dataset_dict(row, grouped[row.id]) for row in rows]


@router.post("/evaluation-datasets")
def create_dataset(body: DatasetInput, db=Depends(database), role=Depends(role_header)):
    managed(role)
    if not body.name.strip():
        raise HTTPException(400, "请输入评测集名称")
    row = EvaluationDataset(id=str(uuid4()), name=body.name.strip(), description=body.description.strip())
    db.add(row)
    db.commit()
    return dataset_dict(row, [])


@router.get("/evaluation-datasets/{id}/cases")
def list_cases(id: str, db=Depends(database), role=Depends(role_header)):
    managed(role)
    dataset(db, id)
    allowed = {kb.id for kb in db.scalars(select(Knowledge)) if role == "admin" or role in kb.visible}
    cases = db.scalars(
        select(EvaluationCase).where(EvaluationCase.dataset_id == id).order_by(EvaluationCase.created.desc())
    )
    return [case_dict(c) for c in cases if set(c.snapshot.get("kbIds", [])).issubset(allowed)]


@router.post("/evaluation-datasets/{id}/cases")
def add_case(id: str, body: CaseInput, db=Depends(database), role=Depends(role_header)):
    managed(role)
    collection = dataset(db, id)
    log = db.get(QueryLog, body.logId)
    if not log:
        raise HTTPException(404, "原始日志不存在或已过期")
    for kb_id in log.kb_ids:
        get_kb(db, kb_id, role)
    row = EvaluationCase(
        id=str(uuid4()),
        dataset_id=id,
        log_id=log.id,
        label=body.label,
        note=body.note.strip(),
        expected=body.expected.strip(),
        snapshot={
            "question": log.question,
            "answer": log.answer,
            "sources": log.sources,
            "kbIds": log.kb_ids,
            "model": log.model,
            "tokens": log.tokens,
            "status": log.status,
            "applicationId": log.application_id,
            "logDate": date(log.created),
            "error": log.error,
        },
    )
    db.add(row)
    collection.updated = utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "这条日志已在该评测集中，可在评测集里修改标签") from None
    return case_dict(row)


@router.patch("/evaluation-cases/{id}")
def edit_case(id: str, body: CaseEdit, db=Depends(database), role=Depends(role_header)):
    managed(role)
    row = db.get(EvaluationCase, id)
    if not row or not visible(db, row, role):
        raise HTTPException(404, "案例不存在或不可见")
    row.label = body.label
    row.note = body.note.strip()
    row.expected = body.expected.strip()
    row.updated = utcnow()
    dataset(db, row.dataset_id).updated = utcnow()
    db.commit()
    return case_dict(row)


@router.delete("/evaluation-cases/{id}")
def remove_case(id: str, db=Depends(database), role=Depends(role_header)):
    managed(role)
    row = db.get(EvaluationCase, id)
    if not row or not visible(db, row, role):
        raise HTTPException(404, "案例不存在或不可见")
    dataset(db, row.dataset_id).updated = utcnow()
    db.delete(row)
    db.commit()
    return {"deleted": True}
