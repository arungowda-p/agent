"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _default_data_dir() -> str:
    # Vercel's filesystem is read-only except /tmp.
    if os.environ.get("VERCEL"):
        return "/tmp/agent-suite-data"
    return str(Path(__file__).resolve().parents[2] / "data")


class Settings(BaseModel):
    app_name: str = "Agent Suite API"
    environment: str = Field(default="development")

    # Storage
    data_dir: Path
    database_url: str = ""
    max_upload_bytes: int = 25 * 1024 * 1024
    upload_chunk_bytes: int = 1024 * 1024

    # LLM (any OpenAI-compatible endpoint; defaults to Gemini's free tier)
    llm_api_key: str = ""
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    llm_model: str = "gemini-2.5-flash"
    llm_fallback_api_key: str = ""
    llm_fallback_base_url: str = "https://api.groq.com/openai/v1"
    llm_fallback_model: str = "llama-3.3-70b-versatile"
    embed_api_key: str = ""
    embed_base_url: str = ""
    embed_model: str = "gemini-embedding-001"
    embed_dimensions: int = 768

    # Tenancy / auth. API_KEYS is a JSON object {"<api-key>": "<tenant-id>"}.
    api_keys: dict[str, str] = Field(default_factory=dict)
    allow_dev_tenant_header: bool = True

    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def embeddings_enabled(self) -> bool:
        return bool(self.embed_api_key or self.llm_api_key)


def _load_dotenv() -> None:
    """Load KEY=VALUE pairs from the repo-root .env for local development (real env vars win)."""
    path = Path(__file__).resolve().parents[3] / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    if not os.environ.get("VERCEL"):
        _load_dotenv()
    raw_keys = _env("API_KEYS")
    api_keys: dict[str, str] = json.loads(raw_keys) if raw_keys else {}
    environment = _env("APP_ENV", "production" if os.environ.get("VERCEL") else "development")
    cors = [o.strip() for o in _env("CORS_ORIGINS", "*").split(",") if o.strip()]
    return Settings(
        environment=environment,
        data_dir=Path(_env("DATA_DIR", _default_data_dir())),
        database_url=_env("DATABASE_URL"),
        max_upload_bytes=int(_env("MAX_UPLOAD_MB", "25")) * 1024 * 1024,
        llm_api_key=_env("LLM_API_KEY"),
        llm_base_url=_env("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"),
        llm_model=_env("LLM_MODEL", "gemini-2.5-flash"),
        llm_fallback_api_key=_env("LLM_FALLBACK_API_KEY"),
        llm_fallback_base_url=_env("LLM_FALLBACK_BASE_URL", "https://api.groq.com/openai/v1"),
        llm_fallback_model=_env("LLM_FALLBACK_MODEL", "llama-3.3-70b-versatile"),
        embed_api_key=_env("EMBED_API_KEY"),
        embed_base_url=_env("EMBED_BASE_URL"),
        embed_model=_env("EMBED_MODEL", "gemini-embedding-001"),
        embed_dimensions=int(_env("EMBED_DIMENSIONS", "768")),
        api_keys=api_keys,
        allow_dev_tenant_header=_env("ALLOW_DEV_TENANT_HEADER", "true" if not api_keys else "false").lower()
        == "true",
        cors_origins=cors,
    )
