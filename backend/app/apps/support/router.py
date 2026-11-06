"""Site Support Agent API: widget builder (tenant-authenticated) + public widget endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from ...core.jobs import JobContext, enqueue
from ...core.models import Job
from ...core.store import get_store
from ...core.tenancy import Tenant, get_tenant, validate_tenant_id
from .schemas import (
    ChatRequest,
    ChatResponse,
    EscalateRequest,
    PublicWidgetConfig,
    Ticket,
    UrlIngestRequest,
    Widget,
    WidgetCreate,
    WidgetOut,
    WidgetPatch,
)
from .service import (
    TICKETS,
    WIDGETS,
    answer_chat,
    chat_limiter,
    crawl_and_index,
    create_ticket,
    load_widget,
    new_source,
    post_to_slack,
    save_widget,
)

router = APIRouter(prefix="/api/v1/support", tags=["support"])
TenantDep = Annotated[Tenant, Depends(get_tenant)]


class IngestResponse(BaseModel):
    job: Job
    widget: WidgetOut


class SlackTestResponse(BaseModel):
    delivered: bool


async def _require(tenant: Tenant, widget_id: str) -> Widget:
    widget = await load_widget(tenant.id, widget_id)
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found.")
    return widget


@router.get("/widgets", response_model=list[WidgetOut])
async def list_widgets(tenant: TenantDep) -> list[WidgetOut]:
    return [WidgetOut.from_widget(Widget.model_validate(r)) for r in await get_store().list(tenant.id, WIDGETS)]


@router.post("/widgets", response_model=WidgetOut, status_code=201)
async def create_widget(body: WidgetCreate, tenant: TenantDep) -> WidgetOut:
    widget = Widget(tenant_id=tenant.id, name=body.name, primary_color=body.primary_color)
    return WidgetOut.from_widget(await save_widget(widget))


@router.get("/widgets/{widget_id}", response_model=WidgetOut)
async def get_widget(widget_id: str, tenant: TenantDep) -> WidgetOut:
    return WidgetOut.from_widget(await _require(tenant, widget_id))


@router.patch("/widgets/{widget_id}", response_model=WidgetOut)
async def patch_widget(widget_id: str, body: WidgetPatch, tenant: TenantDep) -> WidgetOut:
    widget = await _require(tenant, widget_id)
    changes = body.model_dump(exclude_unset=True)
    # The UI receives a masked webhook; ignore it if it is echoed back unchanged.
    if "slack_webhook_url" in changes and "…" in (changes["slack_webhook_url"] or ""):
        changes.pop("slack_webhook_url")
    updated = widget.model_copy(update=changes)
    if body.whitelabel is not None:
        updated.whitelabel = body.whitelabel
    return WidgetOut.from_widget(await save_widget(Widget.model_validate(updated.model_dump())))


@router.delete("/widgets/{widget_id}", status_code=204)
async def delete_widget(widget_id: str, tenant: TenantDep) -> None:
    widget = await _require(tenant, widget_id)
    store = get_store()
    for source in widget.sources:
        for artifact_id in source.artifact_ids:
            await store.delete_chunks(tenant.id, artifact_id)
            await store.delete(tenant.id, "artifacts", artifact_id)
    await store.delete(tenant.id, WIDGETS, widget_id)


@router.post("/widgets/{widget_id}/sources/url", response_model=IngestResponse, status_code=202)
async def ingest_url(
    widget_id: str, body: UrlIngestRequest, background: BackgroundTasks, tenant: TenantDep
) -> IngestResponse:
    widget = await _require(tenant, widget_id)
    url = str(body.url)
    source = next((s for s in widget.sources if s.url == url), None)
    if source is None:
        source = new_source(url, body.max_pages)
        widget.sources.append(source)
    source.max_pages = body.max_pages
    source.status = "queued"
    source.error = None

    async def run(ctx: JobContext) -> dict[str, int]:
        return await crawl_and_index(ctx, tenant.id, widget_id, source.id)

    job = await enqueue(background, tenant.id, "support_crawl", run, message=f"Crawling {url}")
    source.job_id = job.id
    widget = await save_widget(widget)
    return IngestResponse(job=job, widget=WidgetOut.from_widget(widget))


@router.delete("/widgets/{widget_id}/sources/{source_id}", response_model=WidgetOut)
async def delete_source(widget_id: str, source_id: str, tenant: TenantDep) -> WidgetOut:
    widget = await _require(tenant, widget_id)
    source = next((s for s in widget.sources if s.id == source_id), None)
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found.")
    store = get_store()
    for artifact_id in source.artifact_ids:
        await store.delete_chunks(tenant.id, artifact_id)
        await store.delete(tenant.id, "artifacts", artifact_id)
    widget.sources = [s for s in widget.sources if s.id != source_id]
    return WidgetOut.from_widget(await save_widget(widget))


@router.post("/widgets/{widget_id}/slack/test", response_model=SlackTestResponse)
async def test_slack(widget_id: str, tenant: TenantDep) -> SlackTestResponse:
    widget = await _require(tenant, widget_id)
    if not widget.slack_webhook_url:
        raise HTTPException(status_code=400, detail="No Slack webhook configured.")
    delivered = await post_to_slack(widget.slack_webhook_url, f"✅ Test message from support widget '{widget.name}'.")
    return SlackTestResponse(delivered=delivered)


@router.get("/widgets/{widget_id}/tickets", response_model=list[Ticket])
async def list_tickets(widget_id: str, tenant: TenantDep) -> list[Ticket]:
    await _require(tenant, widget_id)
    return [Ticket.model_validate(t) for t in await get_store().list(tenant.id, TICKETS, {"widget_id": widget_id})]


# ---------------------------------------------------------------- public widget endpoints


async def _public_widget(public_key: str, request: Request) -> Widget:
    tenant_part, _, widget_id = public_key.partition(".")
    if not widget_id:
        raise HTTPException(status_code=404, detail="Unknown widget.")
    widget = await load_widget(validate_tenant_id(tenant_part), widget_id)
    if widget is None:
        raise HTTPException(status_code=404, detail="Unknown widget.")
    origin = request.headers.get("origin")
    if widget.allowed_origins and origin and origin not in widget.allowed_origins:
        raise HTTPException(status_code=403, detail="Origin not allowed for this widget.")
    return widget


@router.get("/public/{public_key}/config", response_model=PublicWidgetConfig)
async def public_config(public_key: str, request: Request) -> PublicWidgetConfig:
    widget = await _public_widget(public_key, request)
    wl = widget.whitelabel
    return PublicWidgetConfig(
        name=widget.name,
        primary_color=widget.primary_color,
        position=widget.position,
        greeting=widget.greeting,
        placeholder=widget.placeholder,
        brand_name=wl.brand_name if wl.enabled and wl.brand_name else widget.name,
        show_powered_by=not (wl.enabled and wl.hide_powered_by),
    )


@router.post("/public/{public_key}/chat", response_model=ChatResponse)
async def public_chat(public_key: str, body: ChatRequest, request: Request) -> ChatResponse:
    widget = await _public_widget(public_key, request)
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "anon")
    chat_limiter.check(f"{public_key}:{client_ip.split(',')[0].strip()}")
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from the user.")
    return await answer_chat(widget, body)


@router.post("/public/{public_key}/escalate", response_model=Ticket, status_code=201)
async def public_escalate(public_key: str, body: EscalateRequest, request: Request) -> Ticket:
    widget = await _public_widget(public_key, request)
    client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "anon")
    chat_limiter.check(f"{public_key}:escalate:{client_ip.split(',')[0].strip()}")
    return await create_ticket(widget, body)
