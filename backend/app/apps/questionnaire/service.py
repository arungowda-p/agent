from __future__ import annotations

import asyncio
import csv
import io
import re
from pathlib import Path

from ...core.extract import extract_sections
from ...core.jobs import JobContext
from ...core.llm import LLMUnavailable, complete_json
from ...core.models import Citation, utcnow
from ...core.rag import citations_from, format_context, resolve_citations, retrieve
from ...core.store import get_store
from .schemas import DraftAnswer, Questionnaire, QuestionnaireSummary, QuestionRow

COLLECTION = "questionnaires"
LIBRARY_SCOPE = "library"
# Hybrid-score cut-off for extractive (no-LLM) drafts; tuned for hashing embeddings.
OFFLINE_REVIEW_THRESHOLD = 0.25

SYSTEM_PROMPT = """You are a security and compliance analyst completing vendor security questionnaires and RFPs.
Answer ONLY from the <source> blocks provided. Never invent certifications, controls, dates or numbers.

Rules:
- Write a concise, professional answer (1-4 sentences) in first person plural ("We ...").
- If the question is yes/no, start the answer with "Yes." or "No." when the sources make it clear.
- Cite every source you rely on using its exact id attribute and a verbatim sentence from it.
- confidence = "high"   when the sources directly and fully answer the question.
- confidence = "review" when the sources partially answer it or the answer needs human judgement.
- confidence = "unsure" when the sources do not answer it; then say what information is missing and return no citations.
"""


def summarize(q: Questionnaire) -> QuestionnaireSummary:
    rows = q.rows
    return QuestionnaireSummary(
        id=q.id,
        name=q.name,
        customer=q.customer,
        due_date=q.due_date,
        total=len(rows),
        answered=sum(1 for r in rows if r.answer.strip()),
        high=sum(1 for r in rows if r.confidence == "high"),
        review=sum(1 for r in rows if r.confidence == "review"),
        unsure=sum(1 for r in rows if r.confidence == "unsure"),
        approved=sum(1 for r in rows if r.approved),
        updated_at=q.updated_at,
    )


async def save(q: Questionnaire) -> Questionnaire:
    q.updated_at = utcnow()
    await get_store().put(q.tenant_id, COLLECTION, q.id, q.model_dump(mode="json"))
    return q


async def load(tenant_id: str, questionnaire_id: str) -> Questionnaire | None:
    data = await get_store().get(tenant_id, COLLECTION, questionnaire_id)
    return Questionnaire.model_validate(data) if data else None


_REF_RE = re.compile(r"^[A-Za-z]{0,4}[-.]?\d+(\.\d+)*[a-z]?$")


def parse_questions(path: Path) -> list[QuestionRow]:
    """Turn a spreadsheet / document into question rows.

    For each row the longest cell is treated as the question when it looks like one (ends with '?'
    or is a sentence); a short leading cell matching an id pattern (e.g. 'AC-1', '3.2') becomes the ref.
    """
    rows: list[QuestionRow] = []
    seen: set[str] = set()
    for section in extract_sections(path):
        cells = [c.strip() for c in section.text.split(" | ")] if " | " in section.text else [section.text]
        for line_cells in ([cells] if len(cells) > 1 else [[ln] for ln in section.text.splitlines()]):
            candidates = [c for c in line_cells if len(c) >= 12]
            if not candidates:
                continue
            question = max(candidates, key=len)
            looks_like_question = question.endswith("?") or question.lower().startswith(
                ("describe", "explain", "provide", "list", "does", "do ", "is ", "are ", "how", "what", "please")
            )
            if not looks_like_question:
                continue
            key = question.lower()
            if key in seen:
                continue
            seen.add(key)
            ref = next((c for c in line_cells if c != question and _REF_RE.fullmatch(c)), "")
            category = next(
                (c for c in line_cells if c not in (question, ref) and 2 < len(c) <= 40 and not c.endswith("?")),
                section.location.split("!")[0] if "!" in section.location else "General",
            )
            rows.append(QuestionRow(ref=ref or f"Q{len(rows) + 1}", category=category, question=question))
    return rows


async def draft_answer(tenant_id: str, row: QuestionRow) -> QuestionRow:
    query = f"{row.category}: {row.question}"
    chunks = await retrieve(tenant_id, query, app="questionnaire", scope=LIBRARY_SCOPE, limit=6)
    if not chunks:
        row.answer = "No supporting evidence found in the knowledge library. Upload the relevant policy or past answer."
        row.confidence = "unsure"
        row.citations = []
        row.reasoning = "Retrieval returned no matching sources."
        row.updated_at = utcnow()
        return row
    try:
        draft = await complete_json(
            system=SYSTEM_PROMPT,
            user=f"Question ({row.ref}, category: {row.category}):\n{row.question}\n\nSources:\n{format_context(chunks)}",
            schema=DraftAnswer,
        )
        cited = [Citation(chunk_id=c.chunk_id, source="", location="", quote=c.quote) for c in draft.citations]
        row.citations = resolve_citations(cited, chunks, row.question)
        row.answer = draft.answer.strip()
        row.reasoning = draft.reasoning.strip()
        row.confidence = draft.confidence
        if row.confidence == "high" and not row.citations:
            row.confidence = "review"
    except LLMUnavailable:
        # Extractive mode: cite the best passage plus any passage scoring at least half as well.
        top = [c for c in chunks[:3] if c.score >= chunks[0].score * 0.5]
        row.citations = citations_from(top, row.question)
        row.answer = " ".join(c.quote for c in row.citations)
        row.confidence = "review" if top[0].score >= OFFLINE_REVIEW_THRESHOLD else "unsure"
        row.reasoning = "Extractive draft (no LLM configured): closest matching passages from the library."
    row.updated_at = utcnow()
    return row


async def autofill(ctx: JobContext, tenant_id: str, questionnaire_id: str, row_ids: list[str] | None, overwrite_edited: bool) -> dict[str, int]:
    questionnaire = await load(tenant_id, questionnaire_id)
    if questionnaire is None:
        raise ValueError("Questionnaire not found.")
    targets = [
        r
        for r in questionnaire.rows
        if (row_ids is None or r.id in row_ids) and (overwrite_edited or not (r.edited or r.approved))
    ]
    total = len(targets) or 1
    done = 0
    lock = asyncio.Lock()
    semaphore = asyncio.Semaphore(4)

    async def work(row: QuestionRow) -> None:
        nonlocal done
        async with semaphore:
            updated = await draft_answer(tenant_id, row)
        async with lock:
            # Reload so edits a reviewer made while the job was running are not overwritten.
            fresh = await load(tenant_id, questionnaire_id) or questionnaire
            for index, existing in enumerate(fresh.rows):
                if existing.id == updated.id and (overwrite_edited or not (existing.edited or existing.approved)):
                    fresh.rows[index] = updated
            done += 1
            await save(fresh)
            questionnaire.rows = fresh.rows
            await ctx.update(done / total, f"Answered {done}/{len(targets)}")

    await asyncio.gather(*(work(r) for r in targets))
    summary = summarize(questionnaire)
    return {"answered": done, "high": summary.high, "review": summary.review, "unsure": summary.unsure}


def to_csv(q: Questionnaire) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Ref", "Category", "Question", "Answer", "Confidence", "Approved", "Sources"])
    for r in q.rows:
        sources = "; ".join(f"{c.source} ({c.location})" for c in r.citations)
        writer.writerow([r.ref, r.category, r.question, r.answer, r.confidence, "yes" if r.approved else "no", sources])
    return buffer.getvalue()
