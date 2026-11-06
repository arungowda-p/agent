"""Background job pipeline.

Jobs are persisted in the store (collection ``jobs``) so the frontend can poll
``GET /api/v1/jobs/{id}`` from any instance. Work is executed with FastAPI BackgroundTasks,
which run after the HTTP response has been sent.
"""

from __future__ import annotations

import logging
import traceback
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import BackgroundTasks

from .models import Job, JobStatus, utcnow
from .store import get_store

log = logging.getLogger(__name__)

JOBS = "jobs"


class JobContext:
    def __init__(self, tenant_id: str, job: Job) -> None:
        self.tenant_id = tenant_id
        self.job = job

    async def update(self, progress: float, message: str = "") -> None:
        self.job.progress = max(0.0, min(1.0, round(progress, 3)))
        if message:
            self.job.message = message
        self.job.updated_at = utcnow()
        await get_store().put(self.tenant_id, JOBS, self.job.id, self.job.model_dump(mode="json"))


JobFn = Callable[[JobContext], Awaitable[dict[str, Any] | None]]


async def create_job(tenant_id: str, kind: str, message: str = "Queued") -> Job:
    job = Job(tenant_id=tenant_id, kind=kind, message=message)
    await get_store().put(tenant_id, JOBS, job.id, job.model_dump(mode="json"))
    return job


async def execute_job(tenant_id: str, job: Job, fn: JobFn) -> None:
    ctx = JobContext(tenant_id, job)
    store = get_store()
    job.status = JobStatus.running
    await ctx.update(0.01, "Started")
    try:
        result = await fn(ctx)
        job.status = JobStatus.succeeded
        job.result = result or {}
        await ctx.update(1.0, "Completed")
    except Exception as exc:  # noqa: BLE001 - job boundary: record every failure
        log.error("Job %s failed: %s\n%s", job.id, exc, traceback.format_exc())
        job.status = JobStatus.failed
        job.error = str(exc)[:500]
        job.updated_at = utcnow()
        await store.put(tenant_id, JOBS, job.id, job.model_dump(mode="json"))


async def enqueue(background: BackgroundTasks, tenant_id: str, kind: str, fn: JobFn, message: str = "Queued") -> Job:
    job = await create_job(tenant_id, kind, message)
    background.add_task(execute_job, tenant_id, job, fn)
    return job


async def get_job(tenant_id: str, job_id: str) -> Job | None:
    data = await get_store().get(tenant_id, JOBS, job_id)
    return Job.model_validate(data) if data else None
