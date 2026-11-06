"""Questionnaire Autopilot API."""

from __future__ import annotations

from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from ...core.files import ensure_allowed, safe_filename, stream_to_disk, tenant_upload_dir
from ...core.jobs import JobContext, enqueue
from ...core.models import Job, new_id, utcnow
from ...core.store import get_store
from ...core.tenancy import Tenant, get_tenant
from .schemas import (
    AutofillRequest,
    Questionnaire,
    QuestionnaireCreate,
    QuestionnaireSummary,
    QuestionRow,
    RowPatch,
)
from .service import COLLECTION, autofill, draft_answer, load, parse_questions, save, summarize, to_csv

router = APIRouter(prefix="/api/v1/questionnaire", tags=["questionnaire"])

TenantDep = Annotated[Tenant, Depends(get_tenant)]


class AutofillResponse(BaseModel):
    job: Job
    questionnaire_id: str


async def _require(tenant: Tenant, questionnaire_id: str) -> Questionnaire:
    questionnaire = await load(tenant.id, questionnaire_id)
    if questionnaire is None:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    return questionnaire


@router.get("/questionnaires", response_model=list[QuestionnaireSummary])
async def list_questionnaires(tenant: TenantDep) -> list[QuestionnaireSummary]:
    records = await get_store().list(tenant.id, COLLECTION)
    return [summarize(Questionnaire.model_validate(r)) for r in records]


@router.post("/questionnaires", response_model=Questionnaire, status_code=201)
async def create_questionnaire(body: QuestionnaireCreate, tenant: TenantDep) -> Questionnaire:
    questionnaire = Questionnaire(
        tenant_id=tenant.id,
        name=body.name,
        customer=body.customer,
        due_date=body.due_date,
        rows=[
            QuestionRow(ref=q.ref or f"Q{i + 1}", category=q.category or "General", question=q.question.strip())
            for i, q in enumerate(body.questions)
        ],
    )
    return await save(questionnaire)


@router.post("/questionnaires/import", response_model=Questionnaire, status_code=201)
async def import_questionnaire(
    request: Request,
    tenant: TenantDep,
    x_filename: Annotated[str, Header()],
    x_questionnaire_name: Annotated[str | None, Header()] = None,
    x_customer: Annotated[str | None, Header()] = None,
) -> Questionnaire:
    """Stream an XLSX/CSV/DOCX/PDF questionnaire and extract its questions into rows."""
    filename = safe_filename(unquote(x_filename))
    ensure_allowed(filename)
    questionnaire_id = new_id("qnr")
    destination = tenant_upload_dir(tenant.id, "questionnaire", "imports") / f"{questionnaire_id}__{filename}"
    await stream_to_disk(request.stream(), destination)
    rows = parse_questions(destination)
    if not rows:
        raise HTTPException(status_code=422, detail="No questions detected. Ensure questions end with '?'.")
    questionnaire = Questionnaire(
        id=questionnaire_id,
        tenant_id=tenant.id,
        name=(unquote(x_questionnaire_name or "") or filename.rsplit(".", 1)[0])[:200],
        customer=unquote(x_customer or "")[:200],
        rows=rows,
    )
    return await save(questionnaire)


@router.get("/questionnaires/{questionnaire_id}", response_model=Questionnaire)
async def get_questionnaire(questionnaire_id: str, tenant: TenantDep) -> Questionnaire:
    return await _require(tenant, questionnaire_id)


@router.delete("/questionnaires/{questionnaire_id}", status_code=204)
async def delete_questionnaire(questionnaire_id: str, tenant: TenantDep) -> None:
    if not await get_store().delete(tenant.id, COLLECTION, questionnaire_id):
        raise HTTPException(status_code=404, detail="Questionnaire not found.")


@router.post("/questionnaires/{questionnaire_id}/autofill", response_model=AutofillResponse, status_code=202)
async def start_autofill(
    questionnaire_id: str, body: AutofillRequest, background: BackgroundTasks, tenant: TenantDep
) -> AutofillResponse:
    questionnaire = await _require(tenant, questionnaire_id)

    async def run(ctx: JobContext) -> dict[str, int]:
        return await autofill(ctx, tenant.id, questionnaire_id, body.row_ids, body.overwrite_edited)

    job = await enqueue(background, tenant.id, "questionnaire_autofill", run, message="Drafting answers")
    questionnaire.last_job_id = job.id
    await save(questionnaire)
    return AutofillResponse(job=job, questionnaire_id=questionnaire_id)


@router.patch("/questionnaires/{questionnaire_id}/rows/{row_id}", response_model=QuestionRow)
async def patch_row(questionnaire_id: str, row_id: str, body: RowPatch, tenant: TenantDep) -> QuestionRow:
    questionnaire = await _require(tenant, questionnaire_id)
    for row in questionnaire.rows:
        if row.id == row_id:
            if body.answer is not None and body.answer != row.answer:
                row.answer = body.answer
                row.edited = True
            if body.confidence is not None:
                row.confidence = body.confidence
            if body.approved is not None:
                row.approved = body.approved
            row.updated_at = utcnow()
            await save(questionnaire)
            return row
    raise HTTPException(status_code=404, detail="Row not found.")


@router.post("/questionnaires/{questionnaire_id}/rows/{row_id}/regenerate", response_model=QuestionRow)
async def regenerate_row(questionnaire_id: str, row_id: str, tenant: TenantDep) -> QuestionRow:
    questionnaire = await _require(tenant, questionnaire_id)
    for index, row in enumerate(questionnaire.rows):
        if row.id == row_id:
            row.edited = False
            row.approved = False
            updated = await draft_answer(tenant.id, row)
            questionnaire.rows[index] = updated
            await save(questionnaire)
            return updated
    raise HTTPException(status_code=404, detail="Row not found.")


@router.get("/questionnaires/{questionnaire_id}/export.csv")
async def export_csv(questionnaire_id: str, tenant: TenantDep) -> Response:
    questionnaire = await _require(tenant, questionnaire_id)
    safe = safe_filename(questionnaire.name) or "questionnaire"
    return Response(
        content=to_csv(questionnaire),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe}.csv"'},
    )
