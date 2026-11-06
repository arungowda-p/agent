from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from ...core.models import Citation, new_id, utcnow

Confidence = Literal["high", "review", "unsure", "pending"]


class QuestionRow(BaseModel):
    id: str = Field(default_factory=lambda: new_id("row"))
    ref: str = ""
    category: str = "General"
    question: str
    answer: str = ""
    confidence: Confidence = "pending"
    citations: list[Citation] = Field(default_factory=list)
    reasoning: str = ""
    edited: bool = False
    approved: bool = False
    updated_at: datetime = Field(default_factory=utcnow)


class Questionnaire(BaseModel):
    id: str = Field(default_factory=lambda: new_id("qnr"))
    tenant_id: str
    name: str
    customer: str = ""
    due_date: str | None = None
    rows: list[QuestionRow] = Field(default_factory=list)
    last_job_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class QuestionnaireSummary(BaseModel):
    id: str
    name: str
    customer: str
    due_date: str | None
    total: int
    answered: int
    high: int
    review: int
    unsure: int
    approved: int
    updated_at: datetime


class QuestionInput(BaseModel):
    ref: str = ""
    category: str = "General"
    question: str = Field(min_length=3, max_length=2000)


class QuestionnaireCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    customer: str = Field(default="", max_length=200)
    due_date: str | None = None
    questions: list[QuestionInput] = Field(min_length=1, max_length=1000)


class RowPatch(BaseModel):
    answer: str | None = Field(default=None, max_length=8000)
    confidence: Literal["high", "review", "unsure"] | None = None
    approved: bool | None = None


class AutofillRequest(BaseModel):
    row_ids: list[str] | None = None
    overwrite_edited: bool = False


class CitedQuote(BaseModel):
    chunk_id: str = Field(description="The id attribute of the <source> the quote comes from.")
    quote: str = Field(description="Verbatim sentence copied from that source.")


class DraftAnswer(BaseModel):
    """Structured output contract for the answer drafting model."""

    answer: str = Field(description="Answer written in first person plural on behalf of the company.")
    confidence: Literal["high", "review", "unsure"]
    citations: list[CitedQuote]
    reasoning: str = Field(description="One sentence explaining why the sources support the answer.")
