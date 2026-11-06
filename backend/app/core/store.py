"""Persistence layer.

Two interchangeable backends, both tenant-isolated:

* ``LocalStore``     - JSON files under ``DATA_DIR/tenants/<tenant>/db``. Zero setup, ideal for local dev.
* ``PostgresStore``  - Postgres + pgvector (e.g. a free Supabase or Neon project). Used when DATABASE_URL is set.
  Required for serverless hosting, where local disk is per-instance and ephemeral.

Every method takes the tenant id as its first argument and every query filters on it.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Protocol

import aiofiles

from .config import get_settings
from .models import Chunk, RetrievedChunk

_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")


def tokenize(text: str) -> set[str]:
    return set(_TOKEN_RE.findall(text.lower()))


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def hybrid_score(vector_score: float, query_terms: set[str], text: str) -> float:
    """Blend semantic similarity with keyword overlap so exact terms (e.g. 'SOC 2') are not lost."""
    if not query_terms:
        return vector_score
    overlap = len(query_terms & tokenize(text)) / len(query_terms)
    return 0.75 * vector_score + 0.25 * overlap


class Store(Protocol):
    async def init(self) -> None: ...
    async def put(self, tenant: str, collection: str, record_id: str, data: dict[str, Any]) -> dict[str, Any]: ...
    async def get(self, tenant: str, collection: str, record_id: str) -> dict[str, Any] | None: ...
    async def list(
        self, tenant: str, collection: str, where: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]: ...
    async def delete(self, tenant: str, collection: str, record_id: str) -> bool: ...
    async def add_chunks(self, tenant: str, chunks: list[Chunk]) -> None: ...
    async def delete_chunks(self, tenant: str, artifact_id: str) -> int: ...
    async def get_chunks(self, tenant: str, chunk_ids: list[str]) -> list[RetrievedChunk]: ...
    async def search_chunks(
        self,
        tenant: str,
        embedding: list[float],
        *,
        app: str,
        scope: str | None,
        query_terms: set[str],
        limit: int,
    ) -> list[RetrievedChunk]: ...


def _matches(record: dict[str, Any], where: dict[str, Any] | None) -> bool:
    if not where:
        return True
    return all(record.get(key) == value for key, value in where.items())


class LocalStore:
    """JSON-file store. One file per tenant per collection, written atomically."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._locks: dict[Path, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._cache: dict[Path, dict[str, Any]] = {}

    async def init(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, tenant: str, collection: str) -> Path:
        return self.root / "tenants" / tenant / "db" / f"{collection}.json"

    async def _load(self, path: Path) -> dict[str, Any]:
        if path in self._cache:
            return self._cache[path]
        if path.exists():
            async with aiofiles.open(path, "r", encoding="utf-8") as fh:
                data = json.loads(await fh.read() or "{}")
        else:
            data = {}
        self._cache[path] = data
        return data

    async def _save(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        async with aiofiles.open(tmp, "w", encoding="utf-8") as fh:
            await fh.write(json.dumps(data, default=str))
        os.replace(tmp, path)
        self._cache[path] = data

    async def put(self, tenant: str, collection: str, record_id: str, data: dict[str, Any]) -> dict[str, Any]:
        path = self._path(tenant, collection)
        async with self._locks[path]:
            records = dict(await self._load(path))
            records[record_id] = json.loads(json.dumps(data, default=str))
            await self._save(path, records)
            return records[record_id]

    async def get(self, tenant: str, collection: str, record_id: str) -> dict[str, Any] | None:
        records = await self._load(self._path(tenant, collection))
        record = records.get(record_id)
        return dict(record) if record is not None else None

    async def list(self, tenant: str, collection: str, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        records = await self._load(self._path(tenant, collection))
        items = [dict(r) for r in records.values() if _matches(r, where)]
        items.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
        return items

    async def delete(self, tenant: str, collection: str, record_id: str) -> bool:
        path = self._path(tenant, collection)
        async with self._locks[path]:
            records = dict(await self._load(path))
            existed = records.pop(record_id, None) is not None
            if existed:
                await self._save(path, records)
            return existed

    async def add_chunks(self, tenant: str, chunks: list[Chunk]) -> None:
        path = self._path(tenant, "_chunks")
        async with self._locks[path]:
            records = dict(await self._load(path))
            for chunk in chunks:
                payload = chunk.model_dump(mode="json")
                payload["embedding"] = chunk.embedding
                records[chunk.id] = payload
            await self._save(path, records)

    async def delete_chunks(self, tenant: str, artifact_id: str) -> int:
        path = self._path(tenant, "_chunks")
        async with self._locks[path]:
            records = dict(await self._load(path))
            keep = {k: v for k, v in records.items() if v.get("artifact_id") != artifact_id}
            removed = len(records) - len(keep)
            if removed:
                await self._save(path, keep)
            return removed

    async def get_chunks(self, tenant: str, chunk_ids: list[str]) -> list[RetrievedChunk]:
        records = await self._load(self._path(tenant, "_chunks"))
        return [
            RetrievedChunk(
                id=r["id"],
                artifact_id=r["artifact_id"],
                source=r["source"],
                location=r["location"],
                text=r["text"],
                score=1.0,
            )
            for cid in chunk_ids
            if (r := records.get(cid)) is not None
        ]

    async def search_chunks(
        self,
        tenant: str,
        embedding: list[float],
        *,
        app: str,
        scope: str | None,
        query_terms: set[str],
        limit: int,
    ) -> list[RetrievedChunk]:
        records = await self._load(self._path(tenant, "_chunks"))
        scored: list[RetrievedChunk] = []
        for r in records.values():
            if r.get("tenant_id") != tenant or r.get("app") != app:
                continue
            if scope is not None and r.get("scope") != scope:
                continue
            score = hybrid_score(cosine(embedding, r.get("embedding") or []), query_terms, r["text"])
            scored.append(
                RetrievedChunk(
                    id=r["id"],
                    artifact_id=r["artifact_id"],
                    source=r["source"],
                    location=r["location"],
                    text=r["text"],
                    score=round(score, 4),
                )
            )
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:limit]


POSTGRES_SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS records (
    tenant_id   text        NOT NULL,
    collection  text        NOT NULL,
    id          text        NOT NULL,
    data        jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, collection, id)
);

CREATE TABLE IF NOT EXISTS chunks (
    id           text   PRIMARY KEY,
    tenant_id    text   NOT NULL,
    app          text   NOT NULL,
    scope        text   NOT NULL,
    artifact_id  text   NOT NULL,
    source       text   NOT NULL,
    location     text   NOT NULL,
    ordinal      int    NOT NULL,
    text         text   NOT NULL,
    embedding    vector NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_tenant_scope_idx ON chunks (tenant_id, app, scope);
CREATE INDEX IF NOT EXISTS chunks_artifact_idx ON chunks (tenant_id, artifact_id);
"""


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"


class PostgresStore:
    """Postgres + pgvector backend. Tenant isolation is enforced in every WHERE clause."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._pool: Any = None
        self._lock = asyncio.Lock()

    async def _get_pool(self) -> Any:
        if self._pool is None:
            async with self._lock:
                if self._pool is None:
                    import asyncpg

                    # statement_cache_size=0 keeps it compatible with transaction poolers (Supabase/Neon).
                    self._pool = await asyncpg.create_pool(
                        self.dsn, min_size=0, max_size=5, statement_cache_size=0
                    )
        return self._pool

    async def init(self) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(POSTGRES_SCHEMA)

    async def put(self, tenant: str, collection: str, record_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = json.loads(json.dumps(data, default=str))
        pool = await self._get_pool()
        await pool.execute(
            """
            INSERT INTO records (tenant_id, collection, id, data)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (tenant_id, collection, id)
            DO UPDATE SET data = EXCLUDED.data, updated_at = now()
            """,
            tenant,
            collection,
            record_id,
            json.dumps(payload),
        )
        return payload

    async def get(self, tenant: str, collection: str, record_id: str) -> dict[str, Any] | None:
        pool = await self._get_pool()
        row = await pool.fetchrow(
            "SELECT data FROM records WHERE tenant_id = $1 AND collection = $2 AND id = $3",
            tenant,
            collection,
            record_id,
        )
        return json.loads(row["data"]) if row else None

    async def list(self, tenant: str, collection: str, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        if where:
            rows = await pool.fetch(
                """
                SELECT data FROM records
                WHERE tenant_id = $1 AND collection = $2 AND data @> $3::jsonb
                ORDER BY created_at DESC
                """,
                tenant,
                collection,
                json.dumps(where),
            )
        else:
            rows = await pool.fetch(
                "SELECT data FROM records WHERE tenant_id = $1 AND collection = $2 ORDER BY created_at DESC",
                tenant,
                collection,
            )
        return [json.loads(r["data"]) for r in rows]

    async def delete(self, tenant: str, collection: str, record_id: str) -> bool:
        pool = await self._get_pool()
        result = await pool.execute(
            "DELETE FROM records WHERE tenant_id = $1 AND collection = $2 AND id = $3",
            tenant,
            collection,
            record_id,
        )
        return result.endswith("1")

    async def add_chunks(self, tenant: str, chunks: list[Chunk]) -> None:
        if not chunks:
            return
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO chunks (id, tenant_id, app, scope, artifact_id, source, location, ordinal, text, embedding)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    (
                        c.id,
                        tenant,
                        c.app,
                        c.scope,
                        c.artifact_id,
                        c.source,
                        c.location,
                        c.ordinal,
                        c.text,
                        _vector_literal(c.embedding),
                    )
                    for c in chunks
                ],
            )

    async def delete_chunks(self, tenant: str, artifact_id: str) -> int:
        pool = await self._get_pool()
        result = await pool.execute(
            "DELETE FROM chunks WHERE tenant_id = $1 AND artifact_id = $2", tenant, artifact_id
        )
        return int(result.split()[-1])

    async def get_chunks(self, tenant: str, chunk_ids: list[str]) -> list[RetrievedChunk]:
        if not chunk_ids:
            return []
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT id, artifact_id, source, location, text FROM chunks WHERE tenant_id = $1 AND id = ANY($2::text[])",
            tenant,
            chunk_ids,
        )
        by_id = {r["id"]: r for r in rows}
        return [
            RetrievedChunk(
                id=r["id"],
                artifact_id=r["artifact_id"],
                source=r["source"],
                location=r["location"],
                text=r["text"],
                score=1.0,
            )
            for cid in chunk_ids
            if (r := by_id.get(cid)) is not None
        ]

    async def search_chunks(
        self,
        tenant: str,
        embedding: list[float],
        *,
        app: str,
        scope: str | None,
        query_terms: set[str],
        limit: int,
    ) -> list[RetrievedChunk]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            """
            SELECT id, artifact_id, source, location, text,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM chunks
            WHERE tenant_id = $2
              AND app = $3
              AND ($4::text IS NULL OR scope = $4)
              AND vector_dims(embedding) = $5
            ORDER BY embedding <=> $1::vector
            LIMIT $6
            """,
            _vector_literal(embedding),
            tenant,
            app,
            scope,
            len(embedding),
            limit * 4,
        )
        results = [
            RetrievedChunk(
                id=r["id"],
                artifact_id=r["artifact_id"],
                source=r["source"],
                location=r["location"],
                text=r["text"],
                score=round(hybrid_score(float(r["similarity"]), query_terms, r["text"]), 4),
            )
            for r in rows
        ]
        results.sort(key=lambda c: c.score, reverse=True)
        return results[:limit]


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        settings = get_settings()
        _store = PostgresStore(settings.database_url) if settings.database_url else LocalStore(settings.data_dir)
    return _store
