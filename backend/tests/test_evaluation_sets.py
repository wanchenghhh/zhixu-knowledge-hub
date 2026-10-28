from uuid import uuid4
from app.db import Knowledge, QueryLog, session_factory


def test_collect_label_revise_and_preserve_case_after_log_expires(client, knowledge):
    log_id = str(uuid4())
    with session_factory()() as db:
        db.add(
            QueryLog(
                id=log_id,
                role="admin",
                kb_ids=[knowledge["id"]],
                question="多久报销？",
                answer="15天内 [1]",
                status="success",
                model="test-model",
                tokens=20,
                duration=2.0,
                sources=[{"fileId": "f1", "name": "差旅制度", "location": "第3页", "text": "15天内"}],
            )
        )
        db.commit()
    created = client.post("/api/v1/evaluation-datasets", json={"name": "差旅问答", "description": "线上回流"})
    assert created.status_code == 200, created.text
    dataset_id = created.json()["id"]
    payload = {"logId": log_id, "label": "bad", "note": "期限不准", "expected": "应为15个工作日"}
    added = client.post(f"/api/v1/evaluation-datasets/{dataset_id}/cases", json=payload)
    assert added.status_code == 200, added.text
    case = added.json()
    assert (
        case["snapshot"]["question"] == "多久报销？" and case["snapshot"]["sources"][0]["location"] == "第3页"
    )
    assert client.post(f"/api/v1/evaluation-datasets/{dataset_id}/cases", json=payload).status_code == 409
    revised = client.patch(
        f"/api/v1/evaluation-cases/{case['id']}",
        json={"label": "good", "note": "已核实", "expected": "15天内"},
    )
    assert revised.status_code == 200 and revised.json()["label"] == "good"
    with session_factory()() as db:
        db.delete(db.get(QueryLog, log_id))
        db.commit()
    saved = client.get(f"/api/v1/evaluation-datasets/{dataset_id}/cases").json()
    assert len(saved) == 1 and saved[0]["snapshot"]["answer"] == "15天内 [1]"
    stats = client.get("/api/v1/evaluation-datasets").json()[0]
    assert stats["count"] == 1 and stats["good"] == 1 and stats["bad"] == 0
    assert client.get("/api/v1/evaluation-datasets", headers={"X-Role": "user"}).status_code == 403
    assert client.delete(f"/api/v1/evaluation-cases/{case['id']}").status_code == 200
    assert client.get(f"/api/v1/evaluation-datasets/{dataset_id}/cases").json() == []


def test_manager_cannot_collect_or_view_inaccessible_knowledge(client, knowledge):
    log_id = str(uuid4())
    with session_factory()() as db:
        kb = db.get(Knowledge, knowledge["id"])
        kb.visible = ["admin"]
        db.add(
            QueryLog(
                id=log_id,
                role="admin",
                kb_ids=[knowledge["id"]],
                question="机密问题",
                answer="机密回答",
                status="success",
                model="x",
                duration=0.1,
            )
        )
        db.commit()
    dataset_id = client.post("/api/v1/evaluation-datasets", json={"name": "权限测试"}).json()["id"]
    payload = {"logId": log_id, "label": "bad"}
    assert (
        client.post(
            f"/api/v1/evaluation-datasets/{dataset_id}/cases", json=payload, headers={"X-Role": "manager"}
        ).status_code
        == 404
    )
    assert client.post(f"/api/v1/evaluation-datasets/{dataset_id}/cases", json=payload).status_code == 200
    assert (
        client.get(f"/api/v1/evaluation-datasets/{dataset_id}/cases", headers={"X-Role": "manager"}).json()
        == []
    )
    assert client.get("/api/v1/evaluation-datasets", headers={"X-Role": "manager"}).json()[0]["count"] == 0
    assert (
        client.get(f"/api/v1/observability/runs/{log_id}", headers={"X-Role": "manager"}).status_code == 404
    )
    assert client.get(f"/api/v1/observability/runs/{log_id}", headers={"X-Role": "user"}).status_code == 403
