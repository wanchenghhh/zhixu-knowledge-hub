import math
import time
from collections import Counter, defaultdict
from typing import Any
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from sqlalchemy import func, select
from .db import Chunk, File, Model, engine
from .jobs import terms
from .providers import CloudEmbeddings, rerank
from .security import get_kb, safe_error


def cosine(left, right):
    if len(left) != len(right):
        raise ValueError("索引维度与查询向量不一致，请重建知识库")
    return float(
        sum(a * b for a, b in zip(left, right, strict=True))
        / max(1e-12, math.sqrt(sum(a * a for a in left) * sum(b * b for b in right)))
    )


class KnowledgeRetriever(BaseRetriever):
    db: Any
    kb_ids: list[str]
    role: str
    top_k: int = 5
    threshold: float = 0.3
    use_rerank: bool = True
    calls: list = []
    stages: dict = {}
    warnings: list = []

    def _get_relevant_documents(self, query, *, run_manager):
        began = time.perf_counter()
        self.calls, self.stages, self.warnings = [], {}, []
        kbs = [get_kb(self.db, id, self.role) for id in dict.fromkeys(self.kb_ids)]
        ranked, cache = [], {}
        query_terms = terms(query)
        for kb in kbs:
            model = self.db.get(Model, kb.embedding)
            if not model or model.status != "ready":
                raise ValueError(f"{kb.name} 的向量模型尚未就绪")
            if model.id not in cache:
                start = time.perf_counter()
                adapter = CloudEmbeddings(model)
                cache[model.id] = adapter.embed_query(query)
                self.calls.extend(adapter.usage)
                self.stages["embedding"] = self.stages.get("embedding", 0) + time.perf_counter() - start
            vector = cache[model.id]
            base = (
                select(Chunk)
                .join(File, File.id == Chunk.file_id)
                .where(Chunk.kb_id == kb.id, Chunk.generation == kb.generation, File.status == "ready")
            )
            if engine().dialect.name == "postgresql":
                vector_chunks = list(
                    self.db.scalars(base.order_by(Chunk.embedding.cosine_distance(vector)).limit(30))
                )
                ts_query = func.plainto_tsquery("simple", " ".join(query_terms))
                lexemes = func.to_tsvector("simple", Chunk.terms)
                lexical_chunks = (
                    list(
                        self.db.scalars(
                            base.where(lexemes.op("@@")(ts_query))
                            .order_by(func.ts_rank_cd(lexemes, ts_query).desc())
                            .limit(30)
                        )
                    )
                    if query_terms
                    else []
                )
            else:
                chunks = list(self.db.scalars(base))
                vector_chunks = sorted(chunks, key=lambda c: cosine(vector, c.embedding), reverse=True)[:30]
                lexical_chunks = sorted(
                    [c for c in chunks if set(query_terms) & set(c.terms.split())],
                    key=lambda c: sum(Counter(c.terms.split())[word] for word in query_terms),
                    reverse=True,
                )[:30]
            scores, mapping = defaultdict(float), {}
            for candidates in [vector_chunks, lexical_chunks]:
                for rank, chunk in enumerate(candidates, 1):
                    scores[chunk.id] += 1 / (60 + rank)
                    mapping[chunk.id] = chunk
            for id, score in scores.items():
                chunk = mapping[id]
                similarity = cosine(vector, chunk.embedding)
                ranked.append(
                    (
                        score,
                        Document(
                            page_content=chunk.content,
                            metadata={
                                "chunkId": chunk.id,
                                "fileId": chunk.file_id,
                                "kbId": kb.id,
                                "location": chunk.location,
                                "vectorScore": similarity,
                                "fusedScore": score,
                                "score": max(0, similarity),
                                **chunk.metadata_json,
                            },
                        ),
                    )
                )
        candidates = [doc for _, doc in sorted(ranked, key=lambda item: item[0], reverse=True)[:40]]
        self.stages["retrieval"] = max(0, time.perf_counter() - began - self.stages.get("embedding", 0))
        if candidates and self.use_rerank:
            # Rerank is independent of embedding provider; use the explicitly bound model.
            model_ids = {kb.rerank_model for kb in kbs if kb.rerank and kb.rerank_model}
            if len(model_ids) > 1:
                self.warnings.append("多库绑定不同重排模型，本次使用所选第一个知识库的重排模型")
            model_id = next((kb.rerank_model for kb in kbs if kb.rerank and kb.rerank_model), None)
            model = self.db.get(Model, model_id) if model_id else None
            if model:
                start = time.perf_counter()
                try:
                    results, usage = rerank(
                        model, query, [doc.page_content for doc in candidates], min(20, len(candidates))
                    )
                    reordered = []
                    for item in results:
                        doc = candidates[item["index"]]
                        doc.metadata["score"] = item["relevance_score"]
                        doc.metadata["rerankScore"] = item["relevance_score"]
                        reordered.append(doc)
                    candidates = reordered
                    self.calls.append({"type": "Rerank", "model": model.model, "usage": usage})
                except Exception as exc:
                    self.warnings.append("重排失败，已使用融合结果：" + safe_error(exc))
                self.stages["rerank"] = time.perf_counter() - start
            elif any(kb.rerank for kb in kbs):
                self.warnings.append("尚未绑定重排模型，本次使用融合结果")
        # Thresholds remain model-specific; never combine different vector spaces.
        candidates = [doc for doc in candidates if doc.metadata["score"] >= self.threshold][: self.top_k]
        budget, selected = 0, []
        for doc in candidates:
            if budget + len(doc.page_content) > 12000:
                break
            file = self.db.get(File, doc.metadata["fileId"])
            doc.metadata["name"] = file.name
            budget += len(doc.page_content)
            selected.append(doc)
        return selected


def as_source(doc: Document):
    return {**doc.metadata, "text": doc.page_content}
