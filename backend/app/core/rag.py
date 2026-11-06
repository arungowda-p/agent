"""Artifact indexing pipeline and tenant-filtered retrieval."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from .extract import chunk_sections, extract_sections
from .jobs import JobContext
from .llm import embed
from .models import Artifact, ArtifactStatus, Chunk, Citation, RetrievedChunk, utcnow
from .store import get_store, tokenize

ARTIFACTS = "artifacts"


async def save_artifact(artifact: Artifact) -> Artifact:
    artifact.updated_at = utcnow()
    await get_store().put(artifact.tenant_id, ARTIFACTS, artifact.id, artifact.model_dump(mode="json"))
    return artifact


async def load_artifact(tenant_id: str, artifact_id: str) -> Artifact | None:
    data = await get_store().get(tenant_id, ARTIFACTS, artifact_id)
    return Artifact.model_validate(data) if data else None


async def index_artifact(ctx: JobContext, artifact: Artifact, path: Path) -> dict[str, int]:
    """queued -> processing -> indexed (or failed). Progress is mirrored on both job and artifact."""
    store = get_store()

    async def step(progress: float, message: str) -> None:
        artifact.progress = progress
        await save_artifact(artifact)
        await ctx.update(progress, message)

    try:
        artifact.status = ArtifactStatus.processing
        await step(0.05, "Extracting text")
        sections = await asyncio.to_thread(extract_sections, path)
        if not sections:
            raise ValueError("No extractable text found in file.")

        await step(0.25, f"Chunking {len(sections)} sections")
        text_chunks = chunk_sections(sections)

        await store.delete_chunks(artifact.tenant_id, artifact.id)
        total = len(text_chunks)
        batch = 32
        for start in range(0, total, batch):
            window = text_chunks[start : start + batch]
            vectors = await embed([f"{artifact.filename} — {c.location}\n{c.text}" for c in window])
            await store.add_chunks(
                artifact.tenant_id,
                [
                    Chunk(
                        tenant_id=artifact.tenant_id,
                        app=artifact.app,
                        scope=artifact.scope,
                        artifact_id=artifact.id,
                        source=artifact.filename,
                        location=c.location,
                        ordinal=c.ordinal,
                        text=c.text,
                        embedding=vector,
                    )
                    for c, vector in zip(window, vectors)
                ],
            )
            done = min(start + batch, total)
            await step(0.3 + 0.65 * (done / total), f"Embedded {done}/{total} chunks")

        artifact.status = ArtifactStatus.indexed
        artifact.chunk_count = total
        artifact.error = None
        await step(1.0, "Indexed")
        return {"chunks": total, "sections": len(sections)}
    except Exception as exc:
        artifact.status = ArtifactStatus.failed
        artifact.error = str(exc)[:300]
        await save_artifact(artifact)
        raise


async def retrieve(
    tenant_id: str, query: str, *, app: str, scope: str | None, limit: int = 6, min_score: float = 0.05
) -> list[RetrievedChunk]:
    """Tenant + app + scope filtered hybrid search."""
    [vector] = await embed([query])
    results = await get_store().search_chunks(
        tenant_id, vector, app=app, scope=scope, query_terms=tokenize(query), limit=limit
    )
    return [r for r in results if r.score >= min_score]


def format_context(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no source documents matched)"
    return "\n\n".join(
        f'<source id="{c.id}" file="{c.source}" location="{c.location}">\n{c.text}\n</source>' for c in chunks
    )


def best_quote(text: str, query: str, max_chars: int = 240) -> str:
    """Pick the sentence in ``text`` with the highest keyword overlap with ``query``."""
    terms = tokenize(query)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]
    if not sentences:
        return text[:max_chars]
    ranked = sorted(sentences, key=lambda s: len(terms & tokenize(s)), reverse=True)
    quote = ranked[0]
    return quote if len(quote) <= max_chars else quote[: max_chars - 1] + "…"


def citations_from(chunks: list[RetrievedChunk], query: str) -> list[Citation]:
    return [
        Citation(chunk_id=c.id, source=c.source, location=c.location, quote=best_quote(c.text, query))
        for c in chunks
    ]


def resolve_citations(
    cited: list[Citation], retrieved: list[RetrievedChunk], query: str
) -> list[Citation]:
    """Keep only citations that point at chunks we actually retrieved (drops hallucinated ids)."""
    by_id = {c.id: c for c in retrieved}
    resolved: list[Citation] = []
    for citation in cited:
        chunk = by_id.get(citation.chunk_id)
        if chunk is None:
            continue
        quote = citation.quote.strip()
        if not quote or quote.lower()[:40] not in chunk.text.lower():
            quote = best_quote(chunk.text, query)
        resolved.append(Citation(chunk_id=chunk.id, source=chunk.source, location=chunk.location, quote=quote))
    return resolved
