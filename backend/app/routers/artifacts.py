"""File ingestion engine: streaming uploads, artifact listing, chunk lookup and job polling."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel

from ..core.files import ensure_allowed, safe_filename, stream_to_disk, tenant_upload_dir
from ..core.ingest import queue_indexing, validate_scope
from ..core.jobs import get_job
from ..core.models import AppName, Artifact, Job, RetrievedChunk
from ..core.rag import ARTIFACTS, load_artifact
from ..core.store import get_store
from ..core.tenancy import Tenant, get_tenant

router = APIRouter(prefix="/api/v1", tags=["artifacts"])


class UploadResponse(BaseModel):
    artifact: Artifact
    job: Job


@router.post("/artifacts/upload", response_model=UploadResponse, status_code=202)
async def upload_artifact(
    request: Request,
    background: BackgroundTasks,
    tenant: Annotated[Tenant, Depends(get_tenant)],
    app: Annotated[AppName, Query()],
    scope: Annotated[str, Query()],
    x_filename: Annotated[str, Header()],
    content_type: Annotated[str, Header()] = "application/octet-stream",
) -> UploadResponse:
    """Stream a raw request body to the tenant's upload directory in 1 MB blocks.

    The client sends the file bytes as the body (no multipart), with ``X-Filename`` set.
    """
    validate_scope(scope)
    filename = safe_filename(unquote(x_filename))
    ensure_allowed(filename)
    directory = tenant_upload_dir(tenant.id, app, scope)
    destination = directory / filename
    counter = 1
    while destination.exists():
        destination = directory / f"{destination.stem.rsplit('__', 1)[0]}__{counter}{destination.suffix}"
        counter += 1

    size, sha = await stream_to_disk(request.stream(), destination)

    duplicates = await get_store().list(tenant.id, ARTIFACTS, {"app": app, "scope": scope, "sha256": sha})
    if duplicates:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail=f"Identical file already uploaded as '{duplicates[0]['filename']}'.")

    artifact, job = await queue_indexing(
        background,
        tenant_id=tenant.id,
        app=app,
        scope=scope,
        filename=destination.name,
        path=destination,
        size_bytes=size,
        sha256=sha,
        content_type=content_type,
    )
    return UploadResponse(artifact=artifact, job=job)


@router.get("/artifacts", response_model=list[Artifact])
async def list_artifacts(
    tenant: Annotated[Tenant, Depends(get_tenant)],
    app: Annotated[AppName, Query()],
    scope: Annotated[str | None, Query()] = None,
) -> list[Artifact]:
    where: dict[str, str] = {"app": app}
    if scope:
        where["scope"] = validate_scope(scope)
    return [Artifact.model_validate(r) for r in await get_store().list(tenant.id, ARTIFACTS, where)]


@router.get("/artifacts/chunks", response_model=list[RetrievedChunk])
async def lookup_chunks(
    tenant: Annotated[Tenant, Depends(get_tenant)],
    ids: Annotated[str, Query(description="Comma separated chunk ids")],
) -> list[RetrievedChunk]:
    chunk_ids = [i.strip() for i in ids.split(",") if i.strip()][:50]
    return await get_store().get_chunks(tenant.id, chunk_ids)


@router.get("/artifacts/{artifact_id}", response_model=Artifact)
async def get_artifact(artifact_id: str, tenant: Annotated[Tenant, Depends(get_tenant)]) -> Artifact:
    artifact = await load_artifact(tenant.id, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return artifact


@router.delete("/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(artifact_id: str, tenant: Annotated[Tenant, Depends(get_tenant)]) -> None:
    store = get_store()
    artifact = await load_artifact(tenant.id, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    await store.delete_chunks(tenant.id, artifact_id)
    await store.delete(tenant.id, ARTIFACTS, artifact_id)
    directory = tenant_upload_dir(tenant.id, artifact.app, artifact.scope)
    (directory / artifact.filename).unlink(missing_ok=True)


@router.get("/jobs/{job_id}", response_model=Job)
async def read_job(job_id: str, tenant: Annotated[Tenant, Depends(get_tenant)]) -> Job:
    job = await get_job(tenant.id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job
