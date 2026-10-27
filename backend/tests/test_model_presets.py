"""Provider setup keeps credentials scoped, preserves existing models and never claims a live test."""

from sqlalchemy import select
from app.db import Model, session_factory
from app.config import decrypt


def test_install_without_keys_is_idempotent_and_not_ready(client):
    for provider, count in [("openrouter", 1), ("tongyi", 3)]:
        a = client.post(f"/api/v1/model-presets/{provider}/install", json={})
        assert a.status_code == 200, a.text
        b = client.post(f"/api/v1/model-presets/{provider}/install", json={})
        assert b.status_code == 200
        assert len(a.json()["models"]) == count
        assert {m["id"] for m in a.json()["models"]} == {m["id"] for m in b.json()["models"]}
        assert all(not m["hasKey"] and m["status"] == "untested" for m in a.json()["models"])
        assert not a.json()["connected"]
    configs = client.get("/api/v1/model-presets").json()
    assert configs[0]["models"][0]["model"] == "openrouter/free"
    assert all(not p["hasStoredKey"] for p in configs)


def test_batch_credential_is_encrypted_and_never_crosses_providers(client):
    denied = client.post("/api/v1/model-presets/tongyi/install", json={"apiKey": "fake-tongyi-key"})
    assert denied.status_code == 400
    saved = client.post(
        "/api/v1/model-presets/tongyi/install", json={"apiKey": "fake-tongyi-key", "freeQuotaConfirmed": True}
    )
    assert saved.status_code == 200
    assert "fake-tongyi-key" not in saved.text
    assert all(m["hasKey"] and m["status"] == "untested" for m in saved.json()["models"])
    client.post("/api/v1/model-presets/openrouter/install", json={})
    with session_factory()() as db:
        for model in db.scalars(select(Model)):
            if model.provider == "通义百炼":
                assert model.secret != "fake-tongyi-key"
                assert decrypt(model.secret) == "fake-tongyi-key"
            elif model.provider == "OpenRouter":
                assert not model.secret


def test_provider_setup_requires_admin(client):
    assert client.get("/api/v1/model-presets", headers={"X-Role": "user"}).status_code == 403
    assert (
        client.post(
            "/api/v1/model-presets/openrouter/install", json={}, headers={"X-Role": "manager"}
        ).status_code
        == 403
    )


def test_free_router_test_uses_only_the_free_model(client):
    import json
    import httpx
    import respx

    setup = client.post(
        "/api/v1/model-presets/openrouter/install", json={"apiKey": "fake-openrouter-key"}
    ).json()
    model_id = setup["models"][0]["id"]
    with respx.mock(assert_all_called=True) as network:
        route = network.post("https://openrouter.ai/api/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "test-free",
                    "object": "chat.completion",
                    "created": 1,
                    "model": "openrouter/free",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": "连接成功"},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
                },
            )
        )
        response = client.post(f"/api/v1/models/{model_id}/test", json={})
        assert response.status_code == 200, response.text
        payload = json.loads(route.calls[0].request.content)
        assert payload["model"] == "openrouter/free"
        assert "models" not in payload
    state = client.get("/api/v1/state").json()
    assert next(m for m in state["models"] if m["id"] == model_id)["status"] == "ready"
    repeated = client.post("/api/v1/model-presets/openrouter/install", json={}).json()
    assert repeated["connected"] and repeated["models"][0]["id"] == model_id
