"""Tenant-isolated file storage with 1 MB streaming writes via aiofiles."""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import AsyncIterator
from pathlib import Path

import aiofiles
from fastapi import HTTPException, status

from .config import get_settings

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md", ".html", ".htm", ".json", ".pptx"}


def safe_filename(name: str) -> str:
    base = Path(name.replace("\\", "/")).name
    cleaned = _SAFE_NAME_RE.sub("_", base).strip("._") or "upload"
    return cleaned[:120]


def ensure_allowed(filename: str) -> None:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )


def tenant_upload_dir(tenant_id: str, app: str, scope: str) -> Path:
    root = get_settings().data_dir.resolve()
    target = (root / "tenants" / tenant_id / "uploads" / app / safe_filename(scope)).resolve()
    # Defence in depth: never allow a path to escape the tenant's directory.
    if not str(target).startswith(str(root / "tenants" / tenant_id)):
        raise HTTPException(status_code=400, detail="Invalid upload scope.")
    target.mkdir(parents=True, exist_ok=True)
    return target


async def stream_to_disk(
    stream: AsyncIterator[bytes],
    destination: Path,
    *,
    max_bytes: int | None = None,
    chunk_bytes: int | None = None,
) -> tuple[int, str]:
    """Write an incoming byte stream to disk in fixed-size (default 1 MB) blocks.

    Returns (bytes_written, sha256). Removes the partial file on any failure.
    """
    settings = get_settings()
    limit = max_bytes or settings.max_upload_bytes
    block = chunk_bytes or settings.upload_chunk_bytes
    digest = hashlib.sha256()
    written = 0
    buffer = bytearray()
    tmp = destination.with_suffix(destination.suffix + ".part")
    try:
        async with aiofiles.open(tmp, "wb") as fh:
            async for piece in stream:
                if not piece:
                    continue
                buffer.extend(piece)
                if written + len(buffer) > limit:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds {limit // (1024 * 1024)} MB limit.",
                    )
                while len(buffer) >= block:
                    out = bytes(buffer[:block])
                    del buffer[:block]
                    await fh.write(out)
                    digest.update(out)
                    written += len(out)
            if buffer:
                out = bytes(buffer)
                await fh.write(out)
                digest.update(out)
                written += len(out)
        if written == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty upload.")
        os.replace(tmp, destination)
        return written, digest.hexdigest()
    except BaseException:
        if tmp.exists():
            tmp.unlink()
        raise
