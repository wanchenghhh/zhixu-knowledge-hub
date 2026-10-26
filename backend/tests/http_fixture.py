"""Isolated HTTP contract fixture for browser QA. Never imported by the application."""

import asyncio
import json
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    return {
        "data": [{"index": i, "embedding": [1.0] + [0.0] * 63} for i, _ in enumerate(body["input"])],
        "usage": {"prompt_tokens": 10, "total_tokens": 10},
    }


@app.post("/v1/rerank")
async def rerank(request: Request):
    body = await request.json()
    return {
        "results": [{"index": i, "relevance_score": 0.98 - 0.01 * i} for i, _ in enumerate(body["documents"])]
    }


@app.post("/v1/chat/completions")
async def chat(request: Request):
    body = await request.json()
    if not body.get("stream"):
        return {
            "id": "contract-test",
            "object": "chat.completion",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": "连接成功"}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        }

    async def chunks():
        for text in [
            "【接口契约测试服务】",
            "根据上传的差旅报销资料，",
            "报销需提供发票和支付凭证，",
            "并在 15 个工作日内提交。[1]",
        ]:
            await asyncio.sleep(0.3)
            yield (
                "data: "
                + json.dumps(
                    {
                        "id": "contract-test",
                        "object": "chat.completion.chunk",
                        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                    }
                )
                + "\n\n"
            )
        yield (
            "data: "
            + json.dumps(
                {
                    "id": "contract-test",
                    "object": "chat.completion.chunk",
                    "choices": [],
                    "usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80},
                }
            )
            + "\n\n"
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(chunks(), media_type="text/event-stream")
