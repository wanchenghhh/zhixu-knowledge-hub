import json
from uuid import uuid4
import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from app.config import settings
from app.db import engine
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("HUB_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("HUB_QUEUE_MODE", "manual")
    engine.cache_clear()
    settings.cache_clear()
    with TestClient(app, headers={"X-Role": "admin", "X-Session-ID": str(uuid4())}) as c:
        yield c
    engine().dispose()
    engine.cache_clear()
    settings.cache_clear()


@pytest.fixture
def cloud():
    with respx.mock(assert_all_called=False) as router:

        def embed(request):
            body = json.loads(request.content)
            data = [
                {"index": i, "embedding": [-1.0 if "不存在" in text else 1.0] + [0.0] * 63}
                for i, text in enumerate(body["input"])
            ]
            return httpx.Response(
                200, json={"data": data, "usage": {"prompt_tokens": 12, "total_tokens": 12}}
            )

        router.post("https://aihubmix.com/v1/embeddings").mock(side_effect=embed)
        router.post("https://aihubmix.com/v1/rerank").mock(
            side_effect=lambda request: httpx.Response(
                200,
                json={
                    "results": [
                        {"index": i, "relevance_score": 0.95 - i * 0.1}
                        for i in range(len(json.loads(request.content)["documents"]))
                    ]
                },
            )
        )

        def chat(request):
            body = json.loads(request.content)
            if not body.get("stream"):
                return httpx.Response(
                    200,
                    json={
                        "id": "test",
                        "object": "chat.completion",
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
            events = [
                {
                    "id": "test",
                    "object": "chat.completion.chunk",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": "报销需要发票与支付凭证。[1] 其他引用[999]"},
                            "finish_reason": None,
                        }
                    ],
                },
                {
                    "id": "test",
                    "object": "chat.completion.chunk",
                    "choices": [],
                    "usage": {"prompt_tokens": 30, "completion_tokens": 15, "total_tokens": 45},
                },
            ]
            return httpx.Response(
                200,
                text="".join("data: " + json.dumps(item) + "\n\n" for item in events) + "data: [DONE]\n\n",
                headers={"content-type": "text/event-stream"},
            )

        router.post("https://aihubmix.com/v1/chat/completions").mock(side_effect=chat)
        yield router


@pytest.fixture
def models(client, cloud):
    result = {}
    for type in ["LLM", "Embedding", "Rerank"]:
        body = {
            "name": type,
            "provider": "AIHubMix",
            "type": type,
            "model": "test-" + type,
            "url": "https://aihubmix.com/v1",
            "apiKey": "test-secret-never-expose",
        }
        if type == "Embedding":
            body["dimension"] = 64
        response = client.post("/api/v1/models", json=body)
        assert response.status_code == 200, response.text
        model = response.json()
        response = client.post(f"/api/v1/models/{model['id']}/test")
        assert response.status_code == 200, response.text
        result[type] = model
    return result


@pytest.fixture
def knowledge(client, models):
    body = {
        "name": "测试知识库",
        "embedding": models["Embedding"]["id"],
        "rerankModel": models["Rerank"]["id"],
        "visible": ["admin", "manager", "user"],
    }
    response = client.post("/api/v1/knowledge", json=body)
    assert response.status_code == 200, response.text
    return response.json()
