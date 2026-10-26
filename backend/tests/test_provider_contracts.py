import json
from app.config import encrypt
from app.db import Model
from app.providers import CloudEmbeddings, rerank
import httpx
import pytest
import respx


@pytest.mark.parametrize(
    "provider,base",
    [
        ("OpenRouter", "https://openrouter.ai/api/v1"),
        ("通义百炼", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ],
)
def test_provider_embedding_and_rerank_contracts(client, provider, base):
    model = Model(
        id="contract",
        name="contract",
        provider=provider,
        type="Embedding",
        model="embedding-model",
        url=base,
        secret=encrypt("fixture-key"),
        dimension=64,
        timeout=5,
    )
    rerank_url = (
        "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
        if provider == "通义百炼"
        else base + "/rerank"
    )
    with respx.mock() as router:
        route = router.post(base + "/embeddings").mock(
            return_value=httpx.Response(
                200, json={"data": [{"index": 0, "embedding": [1.0] * 64}], "usage": {"total_tokens": 2}}
            )
        )
        assert len(CloudEmbeddings(model).embed_query("test")) == 64
        assert json.loads(route.calls[0].request.content)["dimensions"] == 64
        route2 = router.post(rerank_url).mock(
            return_value=httpx.Response(
                200,
                json=(
                    {
                        "output": {"results": [{"index": 0, "relevance_score": 0.9}]},
                        "usage": {"total_tokens": 3},
                    }
                    if provider == "通义百炼"
                    else {"results": [{"index": 0, "relevance_score": 0.9}], "usage": {"total_tokens": 3}}
                ),
            )
        )
        result, usage = rerank(model, "query", ["document"], 1)
        payload = json.loads(route2.calls[0].request.content)
        assert (payload["input"]["query"] if provider == "通义百炼" else payload["query"]) == "query"
        assert result[0]["index"] == 0 and usage["total_tokens"] == 3
