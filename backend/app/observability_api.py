"""Fetch one authorized execution's detailed records on demand."""

from fastapi import APIRouter, Depends, HTTPException
from .applications_api import get_run
from .db import ApplicationRun, Job, QueryLog, session_factory
from .security import browser_header, get_kb, managed, role_header

router = APIRouter(prefix="/api/v1/observability")


def database():
    with session_factory()() as db:
        yield db


@router.get("/runs/{id}")
def detail(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    managed(role)
    log = db.get(QueryLog, id)
    if log:
        for kb_id in log.kb_ids:
            get_kb(db, kb_id, role)
        return {
            "calls": log.details.get("calls", []),
            "plan": log.details.get("outline"),
            "input": {"question": log.question, "inputs": log.details.get("inputs")},
            "output": {"answer": log.answer, "sources": log.sources, "sections": log.details.get("sections")},
            "error": log.error,
        }
    job = db.get(Job, id)
    if job:
        get_kb(db, job.kb_id, role)
        return {
            "calls": [*job.options.get("traceEvents", []), *job.usage.get("calls", [])],
            "input": {"fileIds": job.file_ids, "kind": job.kind},
            "output": {"finished": job.finished, "total": len(job.file_ids), "stage": job.stage},
            "error": job.error,
        }
    if db.get(ApplicationRun, id):
        run = get_run(db, id, role, browser)
        return {
            "calls": run.usage.get("calls", []),
            "plan": run.outline,
            "input": {"question": run.question, "inputs": run.inputs},
            "output": {"sections": run.sections, "answer": run.output, "sources": run.sources},
            "error": run.error,
        }
    raise HTTPException(404, "运行不存在或当前角色不可见")
