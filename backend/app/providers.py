"""Cloud adapters. All embedding/rerank calls preserve provider usage when present."""

import math
import time
import httpx
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI
from .config import decrypt
from .db import Model


def endpoint(model: Model, suffix: str):
    if model.provider == "通义百炼" and suffix == "rerank":
        if "/services/rerank/" in model.url:
            return model.url
        host = model.url.split("/compatible-mode")[0]
        return host + "/api/v1/services/rerank/text-rerank/text-rerank"
    return model.url if model.url.endswith("/" + suffix) else model.url + "/" + suffix


def post(model: Model, suffix: str, payload: dict):
    key = decrypt(model.secret)
    if not key:
        raise ValueError(f"{model.name} 尚未配置 API Key")
    with httpx.Client(timeout=model.timeout, follow_redirects=False, trust_env=False) as client:
        response = client.post(
            endpoint(model, suffix), json=payload, headers={"Authorization": f"Bearer {key}"}
        )
    if response.status_code >= 400:
        # Do not persist response bodies: upstream errors can echo input or keys.
        trace = response.headers.get("x-request-id", response.headers.get("tid", ""))[:100]
        raise ValueError(f"模型服务 HTTP {response.status_code}；请求标识：{trace or '未提供'}")
    body = response.json()
    if "error" in body or ("code" in body and body.get("code") not in (None, "", "200", 200)):
        raise ValueError("模型服务返回业务错误，请核对模型 ID、余额与权限")
    return body


class CloudEmbeddings(Embeddings):
    def __init__(self, model: Model, heartbeat=None):
        self.model = model
        self.usage: list[dict] = []
        self.heartbeat = heartbeat

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for start in range(0, len(texts), 10):
            if self.heartbeat:
                self.heartbeat()
            batch = texts[start : start + 10]
            payload = {"model": self.model.model, "input": batch, "encoding_format": "float"}
            if self.model.dimension:
                payload["dimensions"] = self.model.dimension
            began = time.perf_counter()
            body = post(self.model, "embeddings", payload)
            data = sorted(body.get("data", []), key=lambda item: item["index"])
            if len(data) != len(batch) or [item["index"] for item in data] != list(range(len(batch))):
                raise ValueError("向量模型返回的数量或索引不正确")
            for item in data:
                vector = item.get("embedding", [])
                if not vector or any(not isinstance(v, (float, int)) or not math.isfinite(v) for v in vector):
                    raise ValueError("向量模型返回无效数值")
                if self.model.dimension and len(vector) != self.model.dimension:
                    raise ValueError(f"实际向量维度 {len(vector)} 与配置 {self.model.dimension} 不符")
                if not sum(v * v for v in vector):
                    raise ValueError("向量模型返回零向量")
                vectors.append(vector)
            self.usage.append(
                {
                    "type": "Embedding",
                    "model": self.model.model,
                    "usage": body.get("usage"),
                    "duration": round(time.perf_counter() - began, 3),
                }
            )
        if vectors and len({len(v) for v in vectors}) != 1:
            raise ValueError("同一批次向量维度不一致")
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


def rerank(model: Model, question: str, documents: list[str], top_n: int):
    payload = {
        "model": model.model,
        "query": question,
        "documents": documents,
        "top_n": min(top_n, len(documents)),
        "return_documents": False,
    }
    if model.provider == "通义百炼":
        payload = {
            "model": model.model,
            "input": {"query": question, "documents": documents},
            "parameters": {"top_n": min(top_n, len(documents)), "return_documents": False},
        }
    body = post(model, "rerank", payload)
    results = body.get("results", body.get("output", {}).get("results", []))
    indexes = []
    for result in results:
        index, score = result.get("index"), result.get("relevance_score")
        if (
            not isinstance(index, int)
            or index < 0
            or index >= len(documents)
            or index in indexes
            or not isinstance(score, (float, int))
            or not math.isfinite(score)
        ):
            raise ValueError("重排模型返回的索引或分数不正确")
        indexes.append(index)
    if not results:
        raise ValueError("重排模型未返回有效结果")
    return results, body.get("usage")


def llm(model: Model, streaming=False):
    key = decrypt(model.secret)
    if not key:
        raise ValueError("对话模型尚未配置 API Key")
    # Compatible Chat Completions; never silently switch to Responses API.
    return ChatOpenAI(
        model=model.model,
        api_key=key,
        base_url=model.url,
        timeout=model.timeout,
        max_retries=0,
        temperature=0.2,
        max_tokens=2048,
        streaming=streaming,
        stream_usage=streaming,
        use_responses_api=False,
        **(
            {"http_async_client": httpx.AsyncClient(trust_env=False)}
            if streaming
            else {"http_client": httpx.Client(trust_env=False)}
        ),
    )


def test_model(model: Model):
    start = time.perf_counter()
    if model.type == "Embedding":
        adapter = CloudEmbeddings(model)
        vector = adapter.embed_query("模型连通性测试")
        detail = {"dimension": len(vector), "calls": adapter.usage}
    elif model.type == "Rerank":
        result, usage = rerank(model, "年假申请", ["年假需提前申请", "设备采购流程"], 2)
        detail = {"results": result, "usage": usage}
    else:
        adapter = llm(model)
        try:
            result = adapter.invoke("请只回答：连接成功")
        finally:
            adapter.root_client.close()
        if not result.content:
            raise ValueError("对话模型未返回文本")
        detail = {"text": result.text[:200], "usage": result.usage_metadata}
    return {"duration": round(time.perf_counter() - start, 3), **detail}
