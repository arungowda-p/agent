"""Shared Pydantic v2 models used across all three product modules."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


AppName = Literal["questionnaire", "support", "study"]


class ArtifactStatus(StrEnum):
    uploading = "uploading"
    queued = "queued"
    processing = "processing"
    indexed = "indexed"
    failed = "failed"


class Artifact(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str = Field(default_factory=lambda: new_id("art"))
    tenant_id: str
    app: AppName
    scope: str = Field(description="Collection inside the app, e.g. a course id or widget id.")
    filename: str
    content_type: str = "application/octet-stream"
    source_url: str | None = None
    size_bytes: int = 0
    sha256: str = ""
    status: ArtifactStatus = ArtifactStatus.uploading
    progress: float = 0.0
    chunk_count: int = 0
    error: str | None = None
    job_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class Job(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str = Field(default_factory=lambda: new_id("job"))
    tenant_id: str
    kind: str
    status: JobStatus = JobStatus.queued
    progress: float = 0.0
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Chunk(BaseModel):
    id: str = Field(default_factory=lambda: new_id("chk"))
    tenant_id: str
    app: AppName
    scope: str
    artifact_id: str
    source: str
    location: str = Field(description="Human readable position, e.g. 'Page 3' or 'Slide 7'.")
    ordinal: int
    text: str
    embedding: list[float] = Field(default_factory=list, exclude=True)


class RetrievedChunk(BaseModel):
    id: str
    artifact_id: str
    source: str
    location: str
    text: str
    score: float


class Citation(BaseModel):
    chunk_id: str
    source: str
    location: str
    quote: str


class Page(BaseModel):
    items: list[Any]
    total: int
