"""FastAPI application factory for the Agent Suite."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apps.questionnaire.router import router as questionnaire_router
from .apps.study.router import router as study_router
from .apps.support.router import router as support_router
from .core.config import get_settings
from .core.store import get_store
from .routers.artifacts import router as artifacts_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agent-suite")


class Health(BaseModel):
    status: str
    environment: str
    storage: str
    llm: str
    embeddings: str


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await get_store().init()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    @app.get("/api/health", response_model=Health, tags=["system"])
    async def health() -> Health:
        return Health(
            status="ok",
            environment=settings.environment,
            storage="postgres" if settings.database_url else "local",
            llm=settings.llm_model if settings.llm_enabled else "offline (extractive)",
            embeddings=settings.embed_model if settings.embeddings_enabled else "offline (hashing)",
        )

    app.include_router(artifacts_router)
    app.include_router(questionnaire_router)
    app.include_router(support_router)
    app.include_router(study_router)
    return app


app = create_app()
