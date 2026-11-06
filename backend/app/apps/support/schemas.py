from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, HttpUrl, field_validator

from ...core.models import Citation, new_id, utcnow

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class Whitelabel(BaseModel):
    enabled: bool = False
    brand_name: str = Field(default="", max_length=60)
    hide_powered_by: bool = False
    custom_domain: str = Field(default="", max_length=253)
    client_label: str = Field(default="", max_length=80, description="Agency's end-client this widget belongs to.")


class UrlSource(BaseModel):
    id: str = Field(default_factory=lambda: new_id("src"))
    url: str
    max_pages: int = 5
    status: Literal["queued", "crawling", "indexed", "failed"] = "queued"
    pages: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    job_id: str | None = None
    error: str | None = None
    last_crawled_at: datetime | None = None


class Widget(BaseModel):
    id: str = Field(default_factory=lambda: new_id("wdg"))
    tenant_id: str
    name: str
    primary_color: str = Field(default="#6366f1", pattern=HEX_COLOR)
    position: Literal["right", "left"] = "right"
    greeting: str = "Hi! Ask me anything about our product."
    placeholder: str = "Type your question…"
    tone: Literal["friendly", "concise", "formal"] = "friendly"
    slack_webhook_url: str = ""
    slack_channel_label: str = ""
    escalation_email: str = ""
    escalate_on_low_confidence: bool = True
    allowed_origins: list[str] = Field(default_factory=list)
    whitelabel: Whitelabel = Field(default_factory=Whitelabel)
    sources: list[UrlSource] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


def public_key_of(widget: Widget) -> str:
    return f"{widget.tenant_id}.{widget.id}"


class WidgetOut(Widget):
    public_key: str = ""
    slack_configured: bool = False

    @classmethod
    def from_widget(cls, widget: Widget) -> "WidgetOut":
        data = widget.model_dump()
        data["slack_webhook_url"] = _mask(widget.slack_webhook_url)
        return cls(**data, public_key=public_key_of(widget), slack_configured=bool(widget.slack_webhook_url))


def _mask(url: str) -> str:
    return f"{url[:34]}…{url[-4:]}" if len(url) > 40 else url


def _validate_slack(value: str | None) -> str | None:
    if value and not value.startswith("https://hooks.slack.com/"):
        raise ValueError("Slack webhook must start with https://hooks.slack.com/")
    return value


class WidgetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    primary_color: str = Field(default="#6366f1", pattern=HEX_COLOR)


class WidgetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    primary_color: str | None = Field(default=None, pattern=HEX_COLOR)
    position: Literal["right", "left"] | None = None
    greeting: str | None = Field(default=None, max_length=300)
    placeholder: str | None = Field(default=None, max_length=120)
    tone: Literal["friendly", "concise", "formal"] | None = None
    slack_webhook_url: str | None = Field(default=None, max_length=300)
    slack_channel_label: str | None = Field(default=None, max_length=80)
    escalation_email: EmailStr | Literal[""] | None = None
    escalate_on_low_confidence: bool | None = None
    allowed_origins: list[str] | None = Field(default=None, max_length=20)
    whitelabel: Whitelabel | None = None

    _slack = field_validator("slack_webhook_url")(_validate_slack)


class UrlIngestRequest(BaseModel):
    url: HttpUrl
    max_pages: int = Field(default=5, ge=1, le=25)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=4, max_length=64)
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


class CitedQuote(BaseModel):
    chunk_id: str
    quote: str


class SupportReply(BaseModel):
    """Structured output contract for the support model."""

    answer: str
    confidence: Literal["high", "low"]
    needs_escalation: bool = Field(description="True when a human should take over.")
    citations: list[CitedQuote]
    suggested_followups: list[str] = Field(description="Up to 3 short follow-up questions.")


class ChatResponse(BaseModel):
    answer: str
    confidence: Literal["high", "low"]
    needs_escalation: bool
    citations: list[Citation]
    suggested_followups: list[str]


class EscalateRequest(BaseModel):
    session_id: str = Field(min_length=4, max_length=64)
    email: EmailStr
    note: str = Field(default="", max_length=1000)
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


class Ticket(BaseModel):
    id: str = Field(default_factory=lambda: new_id("tkt"))
    tenant_id: str
    widget_id: str
    session_id: str
    email: str
    note: str = ""
    transcript: list[ChatMessage]
    status: Literal["open", "closed"] = "open"
    slack_delivered: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class PublicWidgetConfig(BaseModel):
    name: str
    primary_color: str
    position: str
    greeting: str
    placeholder: str
    brand_name: str
    show_powered_by: bool
