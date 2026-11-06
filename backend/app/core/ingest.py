"""Shared helpers to register an artifact and queue its indexing job."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import BackgroundTasks, HTTPException

from .jobs import JobContext, enqueue
from .models import AppName, Artifact, ArtifactStatus, Job
from .rag import index_artifact, save_artifact

SCOPE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_scope(scope: str) -> str:
    if not SCOPE_RE.fullmatch(scope):
        raise HTTPException(status_code=400, detail="scope must be 1-64 chars of letters, digits, '_' or '-'.")
    return scope


async def queue_indexing(
    background: BackgroundTasks,
    *,
    tenant_id: str,
    app: AppName,
    scope: str,
    filename: str,
    path: Path,
    size_bytes: int,
    sha256: str,
    content_type: str,
    source_url: str | None = None,
) -> tuple[Artifact, Job]:
    artifact = Artifact(
        tenant_id=tenant_id,
        app=app,
        scope=scope,
        filename=filename,
        content_type=content_type,
        source_url=source_url,
        size_bytes=size_bytes,
        sha256=sha256,
        status=ArtifactStatus.queued,
    )

    async def run(ctx: JobContext) -> dict[str, int]:
        result = await index_artifact(ctx, artifact, path)
        return {**result, "artifact_id": artifact.id}  # type: ignore[dict-item]

    job = await enqueue(background, tenant_id, "index_artifact", run, message=f"Queued {filename}")
    artifact.job_id = job.id
    await save_artifact(artifact)
    return artifact, job
