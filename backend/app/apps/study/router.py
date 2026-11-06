"""Study Copilot API."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ...core.store import get_store
from ...core.tenancy import Tenant, get_tenant
from .schemas import (
    AnswerRequest,
    AnswerResult,
    Course,
    CourseCreate,
    CourseOut,
    Flashcard,
    GenerateRequest,
    Quiz,
    QuizPublic,
    ReviewRequest,
    StudyChatRequest,
    StudyChatResponse,
    Topic,
    TopicCreate,
    TopicPatch,
)
from .service import (
    CARDS,
    COURSES,
    QUIZZES,
    generate_flashcards,
    generate_quiz,
    generate_syllabus,
    load_course,
    save_course,
    tutor_chat,
    update_mastery,
)

router = APIRouter(prefix="/api/v1/study", tags=["study"])
TenantDep = Annotated[Tenant, Depends(get_tenant)]

GRADE_SIGNAL = {"again": 0.0, "good": 0.75, "easy": 1.0}


async def _course(tenant: Tenant, course_id: str) -> Course:
    course = await load_course(tenant.id, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found.")
    return course


def _topic(course: Course, topic_id: str | None) -> Topic | None:
    if topic_id is None:
        return None
    topic = next((t for t in course.topics if t.id == topic_id), None)
    if topic is None:
        raise HTTPException(status_code=404, detail="Topic not found.")
    return topic


@router.get("/courses", response_model=list[CourseOut])
async def list_courses(tenant: TenantDep) -> list[CourseOut]:
    return [CourseOut.from_course(Course.model_validate(r)) for r in await get_store().list(tenant.id, COURSES)]


@router.post("/courses", response_model=CourseOut, status_code=201)
async def create_course(body: CourseCreate, tenant: TenantDep) -> CourseOut:
    course = Course(
        tenant_id=tenant.id,
        title=body.title,
        code=body.code,
        topics=[Topic(title=t.strip(), order=i) for i, t in enumerate(body.topics) if t.strip()],
    )
    return CourseOut.from_course(await save_course(course))


@router.get("/courses/{course_id}", response_model=CourseOut)
async def get_course(course_id: str, tenant: TenantDep) -> CourseOut:
    return CourseOut.from_course(await _course(tenant, course_id))


@router.delete("/courses/{course_id}", status_code=204)
async def delete_course(course_id: str, tenant: TenantDep) -> None:
    await _course(tenant, course_id)
    store = get_store()
    for artifact in await store.list(tenant.id, "artifacts", {"app": "study", "scope": course_id}):
        await store.delete_chunks(tenant.id, artifact["id"])
        await store.delete(tenant.id, "artifacts", artifact["id"])
    for card in await store.list(tenant.id, CARDS, {"course_id": course_id}):
        await store.delete(tenant.id, CARDS, card["id"])
    for quiz in await store.list(tenant.id, QUIZZES, {"course_id": course_id}):
        await store.delete(tenant.id, QUIZZES, quiz["id"])
    await store.delete(tenant.id, COURSES, course_id)


@router.post("/courses/{course_id}/topics", response_model=CourseOut, status_code=201)
async def add_topic(course_id: str, body: TopicCreate, tenant: TenantDep) -> CourseOut:
    course = await _course(tenant, course_id)
    course.topics.append(Topic(title=body.title.strip(), order=len(course.topics)))
    return CourseOut.from_course(await save_course(course))


@router.patch("/courses/{course_id}/topics/{topic_id}", response_model=CourseOut)
async def patch_topic(course_id: str, topic_id: str, body: TopicPatch, tenant: TenantDep) -> CourseOut:
    course = await _course(tenant, course_id)
    topic = _topic(course, topic_id)
    assert topic is not None
    if body.title is not None:
        topic.title = body.title.strip()
    if body.order is not None:
        topic.order = body.order
        course.topics.sort(key=lambda t: t.order)
    return CourseOut.from_course(await save_course(course))


@router.delete("/courses/{course_id}/topics/{topic_id}", response_model=CourseOut)
async def delete_topic(course_id: str, topic_id: str, tenant: TenantDep) -> CourseOut:
    course = await _course(tenant, course_id)
    _topic(course, topic_id)
    course.topics = [t for t in course.topics if t.id != topic_id]
    for index, topic in enumerate(course.topics):
        topic.order = index
    return CourseOut.from_course(await save_course(course))


@router.post("/courses/{course_id}/syllabus/generate", response_model=CourseOut)
async def syllabus(course_id: str, tenant: TenantDep) -> CourseOut:
    course = await _course(tenant, course_id)
    try:
        titles = await generate_syllabus(course)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    existing = {t.title.lower() for t in course.topics}
    for title in titles:
        if title.lower() not in existing:
            course.topics.append(Topic(title=title, order=len(course.topics)))
    return CourseOut.from_course(await save_course(course))


@router.post("/courses/{course_id}/chat", response_model=StudyChatResponse)
async def chat(course_id: str, body: StudyChatRequest, tenant: TenantDep) -> StudyChatResponse:
    course = await _course(tenant, course_id)
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from the user.")
    return await tutor_chat(course, body)


@router.get("/courses/{course_id}/flashcards", response_model=list[Flashcard])
async def list_flashcards(course_id: str, tenant: TenantDep, topic_id: str | None = None) -> list[Flashcard]:
    await _course(tenant, course_id)
    where = {"course_id": course_id, **({"topic_id": topic_id} if topic_id else {})}
    return [Flashcard.model_validate(c) for c in await get_store().list(tenant.id, CARDS, where)]


@router.post("/courses/{course_id}/flashcards/generate", response_model=list[Flashcard], status_code=201)
async def create_flashcards(course_id: str, body: GenerateRequest, tenant: TenantDep) -> list[Flashcard]:
    course = await _course(tenant, course_id)
    try:
        return await generate_flashcards(course, _topic(course, body.topic_id), body.count)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/flashcards/{card_id}/review", response_model=CourseOut)
async def review_flashcard(card_id: str, body: ReviewRequest, tenant: TenantDep) -> CourseOut:
    store = get_store()
    data = await store.get(tenant.id, CARDS, card_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Flashcard not found.")
    card = Flashcard.model_validate(data)
    card.reviews += 1
    card.last_grade = body.grade
    await store.put(tenant.id, CARDS, card.id, card.model_dump(mode="json"))
    course = await _course(tenant, card.course_id)
    topic = next((t for t in course.topics if t.id == card.topic_id), None)
    if topic is not None:
        topic.cards_reviewed += 1
        update_mastery(topic, GRADE_SIGNAL[body.grade], weight=0.15)
        await save_course(course)
    return CourseOut.from_course(course)


@router.get("/courses/{course_id}/quizzes", response_model=list[QuizPublic])
async def list_quizzes(course_id: str, tenant: TenantDep) -> list[QuizPublic]:
    await _course(tenant, course_id)
    quizzes = await get_store().list(tenant.id, QUIZZES, {"course_id": course_id})
    return [QuizPublic.from_quiz(Quiz.model_validate(q)) for q in quizzes[:10]]


@router.post("/courses/{course_id}/quizzes/generate", response_model=QuizPublic, status_code=201)
async def create_quiz(course_id: str, body: GenerateRequest, tenant: TenantDep) -> QuizPublic:
    course = await _course(tenant, course_id)
    try:
        quiz = await generate_quiz(course, _topic(course, body.topic_id), body.count)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return QuizPublic.from_quiz(quiz)


@router.post("/quizzes/{quiz_id}/answer", response_model=AnswerResult)
async def answer_question(quiz_id: str, body: AnswerRequest, tenant: TenantDep) -> AnswerResult:
    store = get_store()
    data = await store.get(tenant.id, QUIZZES, quiz_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Quiz not found.")
    quiz = Quiz.model_validate(data)
    question = next((q for q in quiz.questions if q.id == body.question_id), None)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    if body.selected_index >= len(question.options):
        raise HTTPException(status_code=400, detail="Option out of range.")

    first_attempt = question.answered_index is None
    question.answered_index = body.selected_index
    await store.put(tenant.id, QUIZZES, quiz.id, quiz.model_dump(mode="json"))

    correct = body.selected_index == question.correct_index
    course = await _course(tenant, quiz.course_id)
    topic = next((t for t in course.topics if t.id == question.topic_id), None)
    if topic is not None and first_attempt:
        topic.attempts += 1
        topic.correct += int(correct)
        update_mastery(topic, 1.0 if correct else 0.0, weight=0.3)
        await save_course(course)
    return AnswerResult(
        correct=correct,
        correct_index=question.correct_index,
        explanation=question.explanation,
        citation=question.citation,
        topic_id=question.topic_id,
        topic_mastery=topic.mastery if topic else None,
        course_mastery=course.mastery,
    )
