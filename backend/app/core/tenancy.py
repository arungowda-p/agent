"""Tenant resolution. Every data access in the API is scoped by the Tenant returned here."""

from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

TENANT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


@dataclass(frozen=True, slots=True)
class Tenant:
    id: str


def validate_tenant_id(value: str) -> str:
    candidate = value.strip().lower()
    if not TENANT_RE.fullmatch(candidate):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant id must be 2-63 chars of lowercase letters, digits or hyphens.",
        )
    return candidate


async def get_tenant(
    authorization: str | None = Header(default=None),
    x_tenant_id: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Tenant:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        tenant_id = settings.api_keys.get(token)
        if tenant_id:
            return Tenant(id=validate_tenant_id(tenant_id))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key.")

    if settings.allow_dev_tenant_header and x_tenant_id:
        return Tenant(id=validate_tenant_id(x_tenant_id))

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Provide 'Authorization: Bearer <api-key>' (or 'X-Tenant-ID' in development).",
    )
