import json
from types import SimpleNamespace
import httpx
import pytest
from sqlalchemy import select
from app.db import Chunk, File, Job, Knowledge, session_factory
from app.jobs import run_job
from tests.test_workflow import build, upload


def tiny_pdf():
    content = b"BT /F1 12 Tf 40 200 Td (Travel reimbursement requires invoices and receipts.) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
    ]
    data = b"%PDF-1.4\n"
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(data)
    data += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(
        f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:]
    )
    data += b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF"
    return data


def test_real_pdf_text_and_page(client, knowledge):
    id = upload(client, knowledge, tiny_pdf(), "rules.pdf")
    with session_factory()() as db:
        file = db.get(File, id)
        assert file.status == "preview"
        assert file.blocks[0]["location"] == "第 1 页"
        assert "invoices" in file.blocks[0]["text"]


def test_official_docmind_shape_and_reused_job_id(client, knowledge, monkeypatch):
    from alibabacloud_docmind_api20220711.client import Client

    submitted = []

    def response(value):
        return SimpleNamespace(body=SimpleNamespace(to_map=lambda: value))

    def submit(self, request, runtime):
        submitted.append(request.file_name)
        return response({"Data": {"Id": "cloud-job-1"}})

    monkeypatch.setattr(Client, "submit_doc_structure_job_advance", submit)
    monkeypatch.setattr(
        Client,
        "get_doc_structure_result",
        lambda *_: response(
            {
                "Status": "Success",
                "Completed": True,
                "Data": json.dumps(
                    {
                        "layouts": [
                            {
                                "text": "图片中的报销制度",
                                "pageNum": [0],
                                "type": "text",
                                "pos": [{"x": 0, "y": 0}],
                            }
                        ]
                    }
                ),
            }
        ),
    )
    result = client.put(
        "/api/v1/settings/ocr",
        json={"enabled": True, "accessKeyId": "unit-id", "accessKeySecret": "unit-secret"},
    )
    assert result.status_code == 200
    assert "unit-secret" not in result.text
    file_id = upload(client, knowledge, b"image fixture", "image.png")
    with session_factory()() as db:
        file = db.get(File, file_id)
        assert file.blocks[0]["metadata"]["page"] == 1
        assert file.blocks[0]["text"] == "图片中的报销制度"
        assert file.cloud_jobs["document"]["id"] == "cloud-job-1"
        file.status = "failed"
        db.commit()
        job = db.scalar(select(Job).where(Job.kb_id == knowledge["id"]))
        job.status = "failed"
        db.commit()
        job_id = job.id
    retry = client.post(f"/api/v1/tasks/{job_id}/retry")
    assert retry.status_code == 200, retry.text
    run_job(retry.json()["id"])
    assert submitted == ["image.png"]


def test_job_claim_is_idempotent(client, knowledge, cloud):
    id = upload(client, knowledge)
    job_id = build(client, knowledge, id)
    before = cloud.calls.call_count
    run_job(job_id)
    assert cloud.calls.call_count == before


def test_edit_survives_rebuild(client, knowledge):
    id = upload(client, knowledge, "# 报销\n报销需要发票，15 天内提交。".encode())
    build(client, knowledge, id)
    chunk = client.get(f"/api/v1/files/{id}/chunks").json()[0]
    response = client.patch(
        f"/api/v1/chunks/{chunk['id']}", json={"text": "# 报销\n报销需要发票，27 天内提交。"}
    )
    assert response.status_code == 200, response.text
    chunks = client.get(f"/api/v1/files/{id}/chunks").json()
    assert "27 天" in chunks[0]["text"]
    with session_factory()() as db:
        assert "27 天" in db.get(File, id).blocks[0]["text"]


def test_reindex_success_switches_pointer_and_drops_old_vectors(client, models, knowledge):
    id = upload(client, knowledge)
    build(client, knowledge, id)
    new = client.post(
        "/api/v1/models",
        json={
            "name": "new",
            "provider": "AIHubMix",
            "type": "Embedding",
            "model": "new-vector",
            "url": "https://aihubmix.com/v1",
            "dimension": 64,
            "apiKey": "test",
        },
    ).json()
    client.post(f"/api/v1/models/{new['id']}/test")
    response = client.put(f"/api/v1/knowledge/{knowledge['id']}", json={**knowledge, "embedding": new["id"]})
    assert response.status_code == 200, response.text
    with session_factory()() as db:
        old = db.get(Knowledge, knowledge["id"]).generation
    run_job(response.json()["task"]["id"])
    with session_factory()() as db:
        kb = db.get(Knowledge, knowledge["id"])
        assert kb.embedding == new["id"] and kb.generation != old
        assert not list(db.scalars(select(Chunk).where(Chunk.generation == old)))


def test_embedding_config_cannot_change_under_active_vectors(client, models, knowledge):
    model = models["Embedding"]
    response = client.put(
        f"/api/v1/models/{model['id']}", json={**model, "model": "different", "apiKey": "new-key"}
    )
    assert response.status_code == 409


def test_unknown_stream_usage_stays_unknown(client, models, knowledge, cloud):
    id = upload(client, knowledge)
    build(client, knowledge, id)
    packet = {
        "id": "no-usage",
        "object": "chat.completion.chunk",
        "choices": [{"index": 0, "delta": {"content": "已找到依据。[1]"}, "finish_reason": None}],
    }
    cloud.post("https://aihubmix.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text="data: " + json.dumps(packet) + "\n\ndata: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )
    )
    client.post(
        "/api/v1/chat", json={"question": "报销", "kbIds": [knowledge["id"]], "modelId": models["LLM"]["id"]}
    )
    log = client.get("/api/v1/state").json()["logs"][0]
    assert log["tokens"] is None and log["details"]["usageSource"] == "unknown"


def test_recovery_skips_committed_files_without_rebilling(client, knowledge, cloud):
    from datetime import timedelta
    from app.db import utcnow
    from app.jobs import pending_jobs

    file_id = upload(client, knowledge)
    job_id = build(client, knowledge, file_id)
    with session_factory()() as db:
        job = db.get(Job, job_id)
        assert job.options["completed"] == [file_id]
        job.status = "running"
        job.touched = utcnow() - timedelta(hours=1)
        db.commit()
    before = cloud.calls.call_count
    assert job_id in pending_jobs()
    run_job(job_id)
    with session_factory()() as db:
        job = db.get(Job, job_id)
        assert job.finished == 1 and job.status == "success"
    assert cloud.calls.call_count == before


def test_enhanced_mode_keeps_md_local(client, knowledge):
    response = client.post(
        f"/api/v1/knowledge/{knowledge['id']}/upload",
        files={"file": ("local.md", "# Markdown\n无需 OCR 的纯文本".encode())},
        data={"consent": "true", "options": json.dumps({"parseMode": "enhanced"})},
    )
    assert response.status_code == 200
    run_job(response.json()["task"]["id"])
    with session_factory()() as db:
        file = db.get(File, response.json()["file"]["id"])
        assert file.status == "preview" and not file.cloud_jobs


def test_provider_failure_does_not_echo_upstream_body(client, models, cloud):
    cloud.post("https://aihubmix.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            401, json={"error": {"message": "invalid key: private-key-fragment, private-input-text"}}
        )
    )
    response = client.post(f"/api/v1/models/{models['LLM']['id']}/test")
    assert response.status_code == 400 and "401" in response.text
    state = client.get("/api/v1/state")
    assert "private-key-fragment" not in response.text + state.text
    assert "private-input-text" not in response.text + state.text


def test_blank_names_and_questions_are_rejected(client, models):
    assert (
        client.post(
            "/api/v1/knowledge", json={"name": "  ", "embedding": models["Embedding"]["id"]}
        ).status_code
        == 422
    )
    assert client.post("/api/v1/retrieval", json={"question": "  ", "kbIds": ["x"]}).status_code == 422


def test_reindex_retry_rebuilds_all_staging_after_partial_failure(client, models, knowledge, cloud):
    from app.jobs import new_job

    first = upload(client, knowledge, b"# first\ninvoice rules", "first.md")
    second = upload(client, knowledge, b"# second\npayment rules", "second.md")
    build(client, knowledge, first)
    build(client, knowledge, second)
    calls = []

    def embed(request):
        body = json.loads(request.content)
        calls.append(body["input"])
        if len(calls) == 2:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "data": [{"index": i, "embedding": [1.0] * 64} for i, _ in enumerate(body["input"])],
                "usage": {"total_tokens": 3},
            },
        )

    cloud.post("https://aihubmix.com/v1/embeddings").mock(side_effect=embed)
    with session_factory()() as db:
        job = new_job(
            db,
            knowledge["id"],
            "reindex",
            [first, second],
            {"modelId": models["Embedding"]["id"], "generation": "retry-generation"},
        )
        db.commit()
        job_id = job.id
    run_job(job_id)
    with session_factory()() as db:
        job = db.get(Job, job_id)
        assert job.status == "failed" and job.options["completed"] == [first]
        assert not list(db.scalars(select(Chunk).where(Chunk.generation == "retry-generation")))
    response = client.post(f"/api/v1/tasks/{job_id}/retry")
    assert response.status_code == 200, response.text
    run_job(response.json()["id"])
    with session_factory()() as db:
        assert db.get(Job, response.json()["id"]).finished == 2
        assert set(db.scalars(select(Chunk.file_id).where(Chunk.generation == "retry-generation"))) == {
            first,
            second,
        }


def test_busy_conversation_rejects_duplicate_generation(client, models, knowledge):
    from app.db import Conversation
    import time
    from uuid import uuid4

    with session_factory()() as db:
        conversation = Conversation(
            id=str(uuid4()),
            browser_id=client.headers["X-Session-ID"],
            role="admin",
            title="busy",
            kb_ids=[knowledge["id"]],
            messages=[
                {
                    "id": "pending",
                    "kind": "user",
                    "text": "first",
                    "sources": [],
                    "pendingUntil": time.time() + 60,
                }
            ],
        )
        db.add(conversation)
        db.commit()
        id = conversation.id
    response = client.post(
        "/api/v1/chat",
        json={
            "question": "second",
            "kbIds": [knowledge["id"]],
            "modelId": models["LLM"]["id"],
            "conversationId": id,
        },
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_cancelled_answer_preserves_valid_citation_and_unknown_usage(client, models, knowledge, cloud):
    import asyncio
    from types import SimpleNamespace
    from uuid import uuid4
    from app.chat import stream_chat
    from app.schemas import ChatInput
    from app.db import Conversation, QueryLog

    file_id = upload(client, knowledge)
    build(client, knowledge, file_id)
    packets = [
        {
            "id": "cancel-test",
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {"content": part}, "finish_reason": None}],
        }
        for part in ["发票和凭证。[1]", "后续尚未接收的正文"]
    ]
    cloud.post("https://aihubmix.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            text="".join("data: " + json.dumps(p) + "\n\n" for p in packets) + "data: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )
    )
    conversation_id, turn_id = str(uuid4()), str(uuid4())
    with session_factory()() as db:
        db.add(
            Conversation(
                id=conversation_id,
                browser_id=client.headers["X-Session-ID"],
                role="admin",
                title="cancel",
                kb_ids=[knowledge["id"]],
                messages=[
                    {"id": turn_id, "kind": "user", "text": "报销", "sources": [], "pendingUntil": 9999999999}
                ],
            )
        )
        db.commit()
    checks = 0

    async def disconnected():
        nonlocal checks
        checks += 1
        return checks > 1

    body = ChatInput(question="报销", kbIds=[knowledge["id"]], modelId=models["LLM"]["id"])
    with pytest.raises(asyncio.CancelledError):
        async for _ in stream_chat(
            body,
            "admin",
            client.headers["X-Session-ID"],
            conversation_id,
            SimpleNamespace(is_disconnected=disconnected),
            turn_id,
        ):
            pass
    with session_factory()() as db:
        log = db.scalar(select(QueryLog))
        assert log.status == "cancelled" and log.tokens is None
        assert log.sources[0]["fileId"] == file_id and log.answer == "发票和凭证。[1]"
        conversation = db.get(Conversation, conversation_id)
        assert conversation.messages[0]["pendingUntil"] == 0
        assert conversation.messages[-1]["sourceFileIds"] == [file_id]
    client.patch(f"/api/v1/files/{file_id}", json={"action": "disable"})
    session = client.get("/api/v1/state").json()["sessions"][0]
    assert "历史回答已隐藏" in session["messages"][-1]["text"]
