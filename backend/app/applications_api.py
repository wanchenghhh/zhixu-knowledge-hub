"""Published application snapshots, scoped conversations and durable reports."""

import copy
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from pydantic import BaseModel, Field
from .db import Application, ApplicationRun, Conversation, File, Skill, session_factory, utcnow
from .schemas import ApplicationConfig, ApplicationInput, ChatInput
from .security import role_header, browser_header, managed, get_kb
from .processing import resolve_llm
from .serialize import date
from .versions import validate_filters

router = APIRouter(prefix="/api/v1")


def database():
    with session_factory()() as db:
        yield db


def accessible(db, config, role):
    if role != "admin" and role not in config["visible"]:
        return False
    try:
        for id in config["kbIds"]:
            get_kb(db, id, role)
    except HTTPException:
        return False
    return True


def get_application(db, id, role, edit=False):
    if edit:
        managed(role)
    app = db.get(Application, id)
    config = (app.draft if edit or role != "user" else app.published) if app else None
    if not config or not accessible(db, config, role):
        raise HTTPException(404, "应用不存在、未发布或当前角色不可见")
    return app


def validate_config(db, config, role):
    value = config.model_dump()
    model = resolve_llm(db, value["model"])
    value["model"] = model.id
    kbs = [get_kb(db, id, role) for id in value["kbIds"]]
    validate_filters(kbs, value.get("metadataFilters", []))
    if any(not db.get(Skill, skill_id) for skill_id in value["skillIds"]):
        raise HTTPException(400, "所选 Skill 不存在，请重新选择")
    value["skillIds"] = list(dict.fromkeys(value["skillIds"]))
    if len({db.get(Skill, skill_id).name for skill_id in value["skillIds"]}) != len(value["skillIds"]):
        raise HTTPException(400, "一个应用不能绑定同名的多个 Skill 版本")
    value["tools"] = list(dict.fromkeys(value["tools"]))
    if role == "manager" and "manager" not in value["visible"]:
        value["visible"].append("manager")
    value["kbIds"] = list(dict.fromkeys(value["kbIds"]))
    return value


def app_dict(app, role):
    return {
        "id": app.id,
        "draft": app.published if role == "user" else app.draft,
        "published": app.published,
        "revision": app.revision,
        "updated": date(app.updated),
    }


@router.get("/applications")
def applications(db=Depends(database), role=Depends(role_header)):
    return [
        app_dict(a, role)
        for a in db.scalars(select(Application).order_by(Application.updated.desc()))
        if (a.published if role == "user" else a.draft)
        and accessible(db, a.published if role == "user" else a.draft, role)
    ]


@router.post("/applications")
def create(body: ApplicationConfig, db=Depends(database), role=Depends(role_header)):
    managed(role)
    config = validate_config(db, body, role)
    app = Application(id=str(uuid4()), draft=config)
    db.add(app)
    db.commit()
    return app_dict(app, role)


@router.get("/applications/{id}")
def get(id: str, db=Depends(database), role=Depends(role_header)):
    return app_dict(get_application(db, id, role), role)


@router.put("/applications/{id}")
def save(id: str, body: ApplicationConfig, db=Depends(database), role=Depends(role_header)):
    app = get_application(db, id, role, True)
    app.draft = validate_config(db, body, role)
    app.updated = utcnow()
    db.commit()
    return app_dict(app, role)


@router.post("/applications/{id}/publish")
def publish(id: str, db=Depends(database), role=Depends(role_header)):
    managed(role)
    db.execute(select(Application.id).where(Application.id == id).with_for_update())
    app = get_application(db, id, role, True)
    config = validate_config(db, ApplicationConfig.model_validate(app.draft), role)
    if not config["kbIds"]:
        raise HTTPException(400, "请先绑定知识库")
    app.published = copy.deepcopy(config)
    app.revision += 1
    app.updated = utcnow()
    db.commit()
    return app_dict(app, role)


@router.post("/applications/{id}/unpublish")
def unpublish(id: str, db=Depends(database), role=Depends(role_header)):
    app = get_application(db, id, role, True)
    app.published = None
    app.updated = utcnow()
    db.commit()
    return app_dict(app, role)


@router.post("/applications/{id}/copy")
def duplicate(id: str, db=Depends(database), role=Depends(role_header)):
    original = get_application(db, id, role, True)
    config = copy.deepcopy(original.draft)
    config["name"] = config["name"][:70] + " · 副本"
    app = Application(id=str(uuid4()), draft=config)
    db.add(app)
    db.commit()
    return app_dict(app, role)


def validated_inputs(config, inputs):
    if not isinstance(inputs, dict) or any(key not in config["fields"] for key in inputs):
        raise HTTPException(400, "包含未知输入字段")
    if any(not inputs.get(key, "").strip() for key in config["fields"]):
        raise HTTPException(400, "请填写全部输入字段")
    if (
        any(not isinstance(value, str) or len(value) > 2000 for value in inputs.values())
        or sum(len(v) for v in inputs.values()) > 10000
    ):
        raise HTTPException(400, "输入字段内容过长")
    return inputs


@router.post("/applications/{id}/chat")
def chat(
    id: str,
    body: ApplicationInput,
    request: Request,
    db=Depends(database),
    role=Depends(role_header),
    browser=Depends(browser_header),
):
    from .main import start_chat

    app = get_application(db, id, role)
    if not app.published or not accessible(db, app.published, role):
        raise HTTPException(404, "应用未发布或不可见")
    config = app.published
    if config["kind"] != "service":
        raise HTTPException(400, "请使用报告任务入口")
    inputs = validated_inputs(config, body.inputs)
    data = ChatInput(
        question=body.question,
        kbIds=config["kbIds"],
        modelId=config["model"],
        topK=config["topK"],
        threshold=config["threshold"],
        rerank=config["rerank"],
        currentOnly=config["currentOnly"],
        metadataFilters=config.get("metadataFilters", []),
        conversationId=body.conversationId,
    )
    return start_chat(
        data,
        request,
        db,
        role,
        browser,
        {"id": app.id, "revision": app.revision, "config": copy.deepcopy(config), "inputs": inputs},
    )


@router.get("/applications/{id}/conversations")
def conversations(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    app = get_application(db, id, role)
    if not app.published or not accessible(db, app.published, role):
        raise HTTPException(404, "应用未发布或不可见")
    rows = list(
        db.scalars(
            select(Conversation)
            .where(
                Conversation.application_id == id,
                Conversation.role == role,
                Conversation.browser_id == browser,
            )
            .order_by(Conversation.created.desc())
            .limit(100)
        )
    )
    result = []
    for row in rows:
        messages = []
        for item in row.messages:
            valid = True
            for source in [{"fileId": id} for id in item.get("sourceFileIds", [])] + item.get("sources", []):
                file = db.get(File, source["fileId"])
                if not file or file.status != "ready":
                    valid = False
                    break
                try:
                    get_kb(db, file.kb_id, role)
                except HTTPException:
                    valid = False
                    break
            messages.append(
                item if valid else {**item, "text": "引用资料不可用，历史回答已隐藏。", "sources": []}
            )
        result.append(
            {
                "id": row.id,
                "title": row.title,
                "revision": row.application_revision,
                "messages": messages,
                "date": date(row.created),
            }
        )
    return result


def run_dict(run):
    return {
        "id": run.id,
        "applicationId": run.application_id,
        "revision": run.revision,
        "status": run.status,
        "question": run.question,
        "inputs": run.inputs,
        "outline": run.outline,
        "sections": run.sections,
        "output": run.output,
        "sources": run.sources,
        "usage": run.usage,
        "error": run.error,
        "stage": run.stage,
        "created": date(run.created),
        "updated": date(run.touched),
    }


def get_run(db, id, role, browser):
    run = db.get(ApplicationRun, id)
    if not run or run.browser_id != browser or run.role != role:
        raise HTTPException(404, "报告任务不存在")
    app = get_application(db, run.application_id, role)
    active_config = app.draft if run.config.get("_preview") and role != "user" else app.published
    if not active_config or not accessible(db, active_config, role):
        raise HTTPException(404, "应用不可用")
    for id in run.config["kbIds"]:
        get_kb(db, id, role)
    return run


@router.post("/applications/{id}/runs")
def start_run(
    id: str,
    body: ApplicationInput,
    db=Depends(database),
    role=Depends(role_header),
    browser=Depends(browser_header),
):
    from .tasks import notify_run

    app = get_application(db, id, role)
    if not app.published or not accessible(db, app.published, role):
        raise HTTPException(404, "应用未发布或不可见")
    if app.published["kind"] != "report":
        raise HTTPException(400, "此应用使用在线对话入口")
    validated_inputs(app.published, body.inputs)
    run = ApplicationRun(
        id=str(uuid4()),
        application_id=id,
        revision=app.revision,
        config=copy.deepcopy(app.published),
        browser_id=browser,
        role=role,
        question=body.question,
        inputs=body.inputs,
    )
    db.add(run)
    db.commit()
    notify_run(run.id)
    return run_dict(run)


@router.get("/applications/{id}/runs")
def list_runs(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    get_application(db, id, role)
    result = []
    for run in db.scalars(
        select(ApplicationRun)
        .where(
            ApplicationRun.application_id == id,
            ApplicationRun.role == role,
            ApplicationRun.browser_id == browser,
        )
        .order_by(ApplicationRun.created.desc())
        .limit(50)
    ):
        try:
            get_run(db, run.id, role, browser)
        except HTTPException:
            continue
        result.append(run_dict(run))
    return result


@router.get("/application-runs/{id}")
def get_run_api(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    return run_dict(get_run(db, id, role, browser))


class OutlineInput(BaseModel):
    outline: list[str] = Field(min_length=1, max_length=12)


@router.post("/application-runs/{id}/confirm")
def confirm(
    id: str,
    body: OutlineInput,
    db=Depends(database),
    role=Depends(role_header),
    browser=Depends(browser_header),
):
    from .tasks import notify_run

    run = get_run(db, id, role, browser)
    if any(not s.strip() or len(s) > 200 for s in body.outline):
        raise HTTPException(400, "章节标题须为1–200字符")
    claim = db.execute(
        update(ApplicationRun)
        .where(ApplicationRun.id == id, ApplicationRun.status == "awaiting_outline")
        .values(outline=body.outline, status="queued", stage="等待撰写", touched=utcnow())
    )
    if not claim.rowcount:
        raise HTTPException(409, "仅可确认待审批的大纲")
    db.commit()
    db.refresh(run)
    notify_run(id)
    return run_dict(run)


@router.post("/application-runs/{id}/cancel")
def cancel(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    from .application_jobs import run_log

    run = get_run(db, id, role, browser)
    claim = db.execute(
        update(ApplicationRun)
        .where(ApplicationRun.id == id, ApplicationRun.status.in_(["queued", "running", "awaiting_outline"]))
        .values(status="cancelled", stage="已停止", touched=utcnow())
    )
    if not claim.rowcount:
        raise HTTPException(409, "此任务已结束")
    db.commit()
    db.refresh(run)
    run_log(db, run, "cancelled")
    db.commit()
    return run_dict(run)


@router.post("/application-runs/{id}/retry")
def retry(id: str, db=Depends(database), role=Depends(role_header), browser=Depends(browser_header)):
    from .tasks import notify_run

    run = get_run(db, id, role, browser)
    claim = db.execute(
        update(ApplicationRun)
        .where(ApplicationRun.id == id, ApplicationRun.status == "failed")
        .values(status="queued", error=None, stage="恢复任务", touched=utcnow())
    )
    if not claim.rowcount:
        raise HTTPException(409, "仅可重试失败任务")
    db.commit()
    db.refresh(run)
    notify_run(id)
    return run_dict(run)


@router.get("/application-runs/{id}/download")
def download(
    id: str,
    format: str = "markdown",
    db=Depends(database),
    role=Depends(role_header),
    browser=Depends(browser_header),
):
    run = get_run(db, id, role, browser)
    if not run.output:
        raise HTTPException(409, "报告尚未生成正文")
    if format not in {"markdown", "docx"}:
        raise HTTPException(400, "不支持的导出格式")
    payload = run.output.encode()
    media = "text/markdown; charset=utf-8"
    filename = "report.md"
    if format == "docx":
        from .report_export import word_document

        payload = word_document(run.output)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "report.docx"
    return StreamingResponse(
        iter([payload]),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class PreviewInput(BaseModel):
    config: ApplicationConfig
    input: ApplicationInput


@router.post("/applications/{id}/preview")
def preview_application(
    id: str,
    body: PreviewInput,
    request: Request,
    db=Depends(database),
    role=Depends(role_header),
    browser=Depends(browser_header),
):
    from .main import start_chat
    from .tasks import notify_run

    app = get_application(db, id, role, True)
    config = validate_config(db, body.config, role)
    inputs = validated_inputs(config, body.input.inputs)
    if config["kind"] == "service":
        data = ChatInput(
            question=body.input.question,
            kbIds=config["kbIds"],
            modelId=config["model"],
            topK=config["topK"],
            threshold=config["threshold"],
            rerank=config["rerank"],
            currentOnly=config["currentOnly"],
            metadataFilters=config.get("metadataFilters", []),
            conversationId=body.input.conversationId,
        )
        return start_chat(
            data,
            request,
            db,
            role,
            browser,
            {"id": app.id, "revision": -app.revision - 1, "config": config, "inputs": inputs},
        )
    config["_preview"] = True
    run = ApplicationRun(
        id=str(uuid4()),
        application_id=id,
        revision=-app.revision - 1,
        config=config,
        browser_id=browser,
        role=role,
        question=body.input.question,
        inputs=inputs,
    )
    db.add(run)
    db.commit()
    notify_run(run.id)
    return run_dict(run)
