from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
import time
from collections import defaultdict, deque
from urllib.parse import urldefrag, urljoin, urlparse

import aiofiles
import httpx
from fastapi import HTTPException

from ...core.extract import parse_html
from ...core.files import tenant_upload_dir
from ...core.jobs import JobContext
from ...core.llm import LLMUnavailable, complete_json
from ...core.models import Artifact, ArtifactStatus, Citation, utcnow
from ...core.rag import citations_from, format_context, index_artifact, resolve_citations, retrieve, save_artifact
from ...core.store import get_store
from .schemas import ChatRequest, ChatResponse, EscalateRequest, SupportReply, Ticket, UrlSource, Widget

WIDGETS = "support_widgets"
TICKETS = "support_tickets"
USER_AGENT = "AgentSuiteBot/1.0 (+site-support-agent)"

TONES = {
    "friendly": "Warm and helpful, plain language, no jargon.",
    "concise": "Short and direct. Two sentences maximum.",
    "formal": "Professional and precise.",
}


async def load_widget(tenant_id: str, widget_id: str) -> Widget | None:
    data = await get_store().get(tenant_id, WIDGETS, widget_id)
    return Widget.model_validate(data) if data else None


async def save_widget(widget: Widget) -> Widget:
    widget.updated_at = utcnow()
    await get_store().put(widget.tenant_id, WIDGETS, widget.id, widget.model_dump(mode="json"))
    return widget


# ---------------------------------------------------------------- SSRF-safe fetching


def _assert_public_host(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"Cannot resolve host '{host}'.") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise ValueError(f"Refusing to fetch non-public address for '{host}'.")


async def safe_get(client: httpx.AsyncClient, url: str, max_redirects: int = 3) -> httpx.Response:
    current = url
    for _ in range(max_redirects + 1):
        parsed = urlparse(current)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Only http(s) URLs are supported.")
        await asyncio.to_thread(_assert_public_host, parsed.hostname)
        response = await client.get(current, follow_redirects=False)
        if response.is_redirect and "location" in response.headers:
            current = urljoin(current, response.headers["location"])
            continue
        response.raise_for_status()
        return response
    raise ValueError("Too many redirects.")


class _ScaledContext:
    """Maps a child task's 0..1 progress into a slice of the parent job's progress."""

    def __init__(self, parent: JobContext, start: float, end: float, label: str) -> None:
        self.parent, self.start, self.end, self.label = parent, start, end, label

    async def update(self, progress: float, message: str = "") -> None:
        await self.parent.update(self.start + (self.end - self.start) * progress, f"{self.label}: {message}")


async def crawl_and_index(ctx: JobContext, tenant_id: str, widget_id: str, source_id: str) -> dict[str, int]:
    widget = await load_widget(tenant_id, widget_id)
    if widget is None:
        raise ValueError("Widget not found.")
    source = next((s for s in widget.sources if s.id == source_id), None)
    if source is None:
        raise ValueError("Source not found.")

    async def persist_source(**changes: object) -> None:
        fresh = await load_widget(tenant_id, widget_id)
        if fresh is None:
            return
        for s in fresh.sources:
            if s.id == source_id:
                for key, value in changes.items():
                    setattr(s, key, value)
        await save_widget(fresh)

    await persist_source(status="crawling", error=None)
    root = urlparse(source.url)
    queue: deque[str] = deque([source.url])
    seen: set[str] = set()
    pages: list[tuple[str, str]] = []

    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as client:
            while queue and len(pages) < source.max_pages:
                url = urldefrag(queue.popleft())[0]
                if url in seen:
                    continue
                seen.add(url)
                try:
                    response = await safe_get(client, url)
                except (httpx.HTTPError, ValueError):
                    if not pages and url == source.url:
                        raise
                    continue
                if "text/html" not in response.headers.get("content-type", ""):
                    continue
                pages.append((url, response.text))
                await ctx.update(0.3 * len(pages) / source.max_pages, f"Fetched {len(pages)} page(s)")
                _, _, links = parse_html(response.text)
                for link in links:
                    absolute = urldefrag(urljoin(url, link))[0]
                    parsed = urlparse(absolute)
                    if parsed.hostname == root.hostname and parsed.scheme in {"http", "https"} and absolute not in seen:
                        queue.append(absolute)

        if not pages:
            raise ValueError("No HTML pages could be fetched from that URL.")

        store = get_store()
        for old_id in source.artifact_ids:
            await store.delete_chunks(tenant_id, old_id)
            await store.delete(tenant_id, "artifacts", old_id)

        directory = tenant_upload_dir(tenant_id, "support", widget_id)
        artifact_ids: list[str] = []
        for index, (url, html) in enumerate(pages):
            name = hashlib.sha1(url.encode()).hexdigest()[:12] + ".html"
            path = directory / name
            async with aiofiles.open(path, "w", encoding="utf-8") as fh:
                await fh.write(html)
            parsed = urlparse(url)
            artifact = Artifact(
                tenant_id=tenant_id,
                app="support",
                scope=widget_id,
                filename=(parsed.netloc + (parsed.path if parsed.path not in ("", "/") else "/"))[:120],
                content_type="text/html",
                source_url=url,
                size_bytes=len(html.encode()),
                sha256=hashlib.sha256(html.encode()).hexdigest(),
                status=ArtifactStatus.queued,
                job_id=ctx.job.id,
            )
            await save_artifact(artifact)
            start = 0.3 + 0.7 * index / len(pages)
            end = 0.3 + 0.7 * (index + 1) / len(pages)
            await index_artifact(_ScaledContext(ctx, start, end, url), artifact, path)  # type: ignore[arg-type]
            artifact_ids.append(artifact.id)

        await persist_source(
            status="indexed", pages=[u for u, _ in pages], artifact_ids=artifact_ids, last_crawled_at=utcnow()
        )
        return {"pages": len(pages)}
    except Exception as exc:
        await persist_source(status="failed", error=str(exc)[:300])
        raise


# ---------------------------------------------------------------- chat


def _system_prompt(widget: Widget) -> str:
    brand = widget.whitelabel.brand_name if widget.whitelabel.enabled and widget.whitelabel.brand_name else widget.name
    return f"""You are the website support assistant for {brand}.
Tone: {TONES[widget.tone]}
Answer ONLY using the <source> blocks. If the sources do not contain the answer, say you are not sure,
set confidence to "low" and needs_escalation to true. Never make up prices, policies, or contact details.
Set needs_escalation to true as well when the visitor asks for a human, a refund, account changes, or is upset.
Cite each source you used with its exact id and a verbatim sentence. Suggest up to 3 short follow-up questions
that the sources can answer."""


async def answer_chat(widget: Widget, body: ChatRequest) -> ChatResponse:
    question = body.messages[-1].content
    history = "\n".join(f"{m.role.upper()}: {m.content}" for m in body.messages[-7:-1])
    chunks = await retrieve(widget.tenant_id, question, app="support", scope=widget.id, limit=5)

    try:
        reply = await complete_json(
            system=_system_prompt(widget),
            user=f"Conversation so far:\n{history or '(none)'}\n\nVisitor question: {question}\n\nSources:\n{format_context(chunks)}",
            schema=SupportReply,
            temperature=0.2,
            max_tokens=900,
        )
        citations = resolve_citations(
            [Citation(chunk_id=c.chunk_id, source="", location="", quote=c.quote) for c in reply.citations],
            chunks,
            question,
        )
        confidence = reply.confidence if citations or reply.confidence == "low" else "low"
        needs_escalation = reply.needs_escalation or (widget.escalate_on_low_confidence and confidence == "low")
        return ChatResponse(
            answer=reply.answer.strip(),
            confidence=confidence,
            needs_escalation=needs_escalation,
            citations=citations,
            suggested_followups=[f.strip() for f in reply.suggested_followups if f.strip()][:3],
        )
    except LLMUnavailable:
        if not chunks:
            return ChatResponse(
                answer="I couldn't find that in our help content. Would you like to talk to a person?",
                confidence="low",
                needs_escalation=True,
                citations=[],
                suggested_followups=[],
            )
        top = [c for c in chunks[:2] if c.score >= chunks[0].score * 0.5]
        citations = citations_from(top, question)
        confident = chunks[0].score >= 0.25
        return ChatResponse(
            answer="Here's what I found: " + " ".join(c.quote for c in citations),
            confidence="high" if confident else "low",
            needs_escalation=not confident and widget.escalate_on_low_confidence,
            citations=citations,
            suggested_followups=[],
        )


# ---------------------------------------------------------------- escalation


async def post_to_slack(webhook_url: str, text: str, blocks: list[dict] | None = None) -> bool:
    if not webhook_url.startswith("https://hooks.slack.com/"):
        return False
    payload: dict = {"text": text}
    if blocks:
        payload["blocks"] = blocks
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(webhook_url, json=payload)
            return response.status_code == 200
    except httpx.HTTPError:
        return False


async def create_ticket(widget: Widget, body: EscalateRequest) -> Ticket:
    ticket = Ticket(
        tenant_id=widget.tenant_id,
        widget_id=widget.id,
        session_id=body.session_id,
        email=str(body.email),
        note=body.note,
        transcript=body.messages,
    )
    if widget.slack_webhook_url:
        transcript = "\n".join(f"*{m.role}*: {m.content[:300]}" for m in body.messages[-8:])
        ticket.slack_delivered = await post_to_slack(
            widget.slack_webhook_url,
            f"New support escalation from {ticket.email}",
            [
                {"type": "header", "text": {"type": "plain_text", "text": f"Escalation · {widget.name}"}},
                {
                    "type": "section",
                    "fields": [
                        {"type": "mrkdwn", "text": f"*Visitor*\n{ticket.email}"},
                        {"type": "mrkdwn", "text": f"*Ticket*\n{ticket.id}"},
                    ],
                },
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*Note*\n{ticket.note or '—'}"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": transcript[:2900]}},
            ],
        )
    await get_store().put(widget.tenant_id, TICKETS, ticket.id, ticket.model_dump(mode="json"))
    return ticket


# ---------------------------------------------------------------- public rate limiting


class RateLimiter:
    """In-process sliding window limiter for the public widget endpoints.

    On serverless each instance keeps its own window; for a global limit use Upstash Redis.
    """

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        bucket = self.hits[key]
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            raise HTTPException(status_code=429, detail="Too many messages. Please wait a moment.")
        bucket.append(now)


chat_limiter = RateLimiter(limit=20, window_seconds=60)


def new_source(url: str, max_pages: int) -> UrlSource:
    return UrlSource(url=url, max_pages=max_pages)
