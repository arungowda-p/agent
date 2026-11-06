from __future__ import annotations

import random
import re
from difflib import SequenceMatcher

from ...core.llm import LLMUnavailable, complete_json
from ...core.models import Citation, RetrievedChunk, utcnow
from ...core.rag import best_quote, format_context, resolve_citations, retrieve
from ...core.store import get_store, tokenize
from .schemas import (
    Course,
    Flashcard,
    GeneratedDeck,
    GeneratedQuiz,
    GeneratedSyllabus,
    Quiz,
    QuizQuestion,
    StudyChatRequest,
    StudyChatResponse,
    Topic,
    TutorReply,
)

COURSES = "study_courses"
CARDS = "study_flashcards"
QUIZZES = "study_quizzes"

STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "are", "was", "were", "which", "their", "have",
    "has", "into", "also", "such", "these", "those", "can", "will", "not", "but", "when", "where", "what",
}


async def load_course(tenant_id: str, course_id: str) -> Course | None:
    data = await get_store().get(tenant_id, COURSES, course_id)
    return Course.model_validate(data) if data else None


async def save_course(course: Course) -> Course:
    course.updated_at = utcnow()
    await get_store().put(course.tenant_id, COURSES, course.id, course.model_dump(mode="json"))
    return course


def match_topic(course: Course, label: str | None) -> Topic | None:
    if not label or not course.topics:
        return None
    best = max(course.topics, key=lambda t: SequenceMatcher(None, t.title.lower(), label.lower()).ratio())
    return best if SequenceMatcher(None, best.title.lower(), label.lower()).ratio() >= 0.45 else None


def update_mastery(topic: Topic, signal: float, weight: float) -> None:
    topic.mastery = round(min(1.0, max(0.0, topic.mastery * (1 - weight) + signal * weight)), 3)


def _cite(chunk: RetrievedChunk, query: str) -> Citation:
    return Citation(chunk_id=chunk.id, source=chunk.source, location=chunk.location, quote=best_quote(chunk.text, query))


async def _material(course: Course, topic: Topic | None, limit: int) -> list[RetrievedChunk]:
    query = topic.title if topic else f"{course.title} " + " ".join(t.title for t in course.topics[:12])
    chunks = await retrieve(course.tenant_id, query, app="study", scope=course.id, limit=limit, min_score=0.0)
    return chunks


# ---------------------------------------------------------------- tutor chat

TUTOR_PROMPT = """You are a patient study tutor. Explain using ONLY the student's course material in the <source> blocks.
Use short paragraphs or bullet points. Add footnote markers [1], [2] … in the answer that correspond to the
order of the citations you return. If the material does not cover the question, say so and suggest which topic
to review. Never invent facts that are not in the sources."""


async def tutor_chat(course: Course, body: StudyChatRequest) -> StudyChatResponse:
    question = body.messages[-1].content
    topic = next((t for t in course.topics if t.id == body.topic_id), None)
    query = f"{topic.title}: {question}" if topic else question
    chunks = await retrieve(course.tenant_id, query, app="study", scope=course.id, limit=6)
    if not chunks:
        return StudyChatResponse(
            answer="I couldn't find this in your uploaded material yet. Upload the lecture slides or notes for this topic and ask again.",
            citations=[],
        )
    history = "\n".join(f"{m.role.upper()}: {m.content}" for m in body.messages[-7:-1])
    try:
        reply = await complete_json(
            system=TUTOR_PROMPT,
            user=f"Course: {course.title}\nConversation:\n{history or '(none)'}\n\nStudent: {question}\n\nSources:\n{format_context(chunks)}",
            schema=TutorReply,
            temperature=0.3,
        )
        citations = resolve_citations(
            [Citation(chunk_id=c.chunk_id, source="", location="", quote=c.quote) for c in reply.citations],
            chunks,
            question,
        )
        return StudyChatResponse(answer=reply.answer.strip(), citations=citations)
    except LLMUnavailable:
        citations = [_cite(c, question) for c in chunks[:3]]
        answer = "\n".join(f"- {c.quote} [{i + 1}]" for i, c in enumerate(citations))
        return StudyChatResponse(answer=f"From your material:\n{answer}", citations=citations)


# ---------------------------------------------------------------- flashcards

CARDS_PROMPT = """Create spaced-repetition flashcards from the course material in the <source> blocks.
Each card tests ONE fact or concept. Front: a precise question or term (max 20 words).
Back: the answer in 1-2 sentences (max 45 words). Use only facts present in the sources.
Set topic to the best matching topic from the provided topic list and chunk_id to the source id used."""


def _keyword(sentence: str) -> str | None:
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z-]{4,}", sentence) if w.lower() not in STOPWORDS]
    return max(words, key=len) if words else None


def _offline_cards(course: Course, topic: Topic | None, chunks: list[RetrievedChunk], count: int) -> list[Flashcard]:
    cards: list[Flashcard] = []
    for chunk in chunks:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", chunk.text) if 40 <= len(s.strip()) <= 220]
        chunk_topic = topic or match_topic(course, chunk.location)
        for sentence in sentences:
            keyword = _keyword(sentence)
            if not keyword:
                continue
            cards.append(
                Flashcard(
                    tenant_id=course.tenant_id,
                    course_id=course.id,
                    topic_id=chunk_topic.id if chunk_topic else None,
                    front=re.sub(rf"\b{re.escape(keyword)}\b", "_____", sentence, count=1),
                    back=keyword,
                    citation=Citation(chunk_id=chunk.id, source=chunk.source, location=chunk.location, quote=sentence),
                )
            )
            if len(cards) >= count:
                return cards
    return cards


async def generate_flashcards(course: Course, topic: Topic | None, count: int) -> list[Flashcard]:
    chunks = await _material(course, topic, limit=8)
    if not chunks:
        raise ValueError("Upload course material before generating flashcards.")
    by_id = {c.id: c for c in chunks}
    try:
        deck = await complete_json(
            system=CARDS_PROMPT,
            user=(
                f"Create exactly {count} flashcards.\nTopics: {', '.join(t.title for t in course.topics) or 'General'}\n"
                f"{'Focus topic: ' + topic.title if topic else ''}\n\nSources:\n{format_context(chunks)}"
            ),
            schema=GeneratedDeck,
            temperature=0.4,
            max_tokens=3000,
        )
        cards = []
        for item in deck.cards[:count]:
            chunk = by_id.get(item.chunk_id) or chunks[0]
            matched = topic or match_topic(course, item.topic) or match_topic(course, chunk.location)
            cards.append(
                Flashcard(
                    tenant_id=course.tenant_id,
                    course_id=course.id,
                    topic_id=matched.id if matched else None,
                    front=item.front.strip(),
                    back=item.back.strip(),
                    citation=_cite(chunk, item.front + " " + item.back),
                )
            )
    except LLMUnavailable:
        cards = _offline_cards(course, topic, chunks, count)
    store = get_store()
    for card in cards:
        await store.put(course.tenant_id, CARDS, card.id, card.model_dump(mode="json"))
    return cards


# ---------------------------------------------------------------- quizzes

QUIZ_PROMPT = """Write multiple-choice questions that test understanding of the course material in the <source> blocks.
Rules: exactly 4 options per question, exactly one correct; distractors must be plausible and drawn from related
concepts in the material; avoid "all of the above". correct_index is 0-based. The explanation (1-2 sentences)
says why the answer is right. Set topic to the best matching topic and chunk_id to the source id used."""


def _offline_quiz(course: Course, topic: Topic | None, chunks: list[RetrievedChunk], count: int) -> list[QuizQuestion]:
    pool = sorted({w for c in chunks for w in tokenize(c.text) if len(w) > 5 and w not in STOPWORDS})
    questions: list[QuizQuestion] = []
    rng = random.Random(course.id)
    for card in _offline_cards(course, topic, chunks, count * 2):
        answer = card.back
        distractors = [w for w in pool if w != answer.lower()]
        rng.shuffle(distractors)
        if len(distractors) < 3:
            continue
        options = [answer] + [d.capitalize() for d in distractors[:3]]
        rng.shuffle(options)
        questions.append(
            QuizQuestion(
                question=f"Fill in the blank: {card.front}",
                options=options,
                correct_index=options.index(answer),
                explanation=f"The material states: “{card.citation.quote if card.citation else ''}”",
                topic_id=card.topic_id,
                citation=card.citation,
            )
        )
        if len(questions) >= count:
            break
    return questions


async def generate_quiz(course: Course, topic: Topic | None, count: int) -> Quiz:
    chunks = await _material(course, topic, limit=8)
    if not chunks:
        raise ValueError("Upload course material before generating a quiz.")
    by_id = {c.id: c for c in chunks}
    try:
        generated = await complete_json(
            system=QUIZ_PROMPT,
            user=(
                f"Write exactly {count} questions.\nTopics: {', '.join(t.title for t in course.topics) or 'General'}\n"
                f"{'Focus topic: ' + topic.title if topic else ''}\n\nSources:\n{format_context(chunks)}"
            ),
            schema=GeneratedQuiz,
            temperature=0.5,
            max_tokens=3500,
        )
        questions = []
        for item in generated.questions[:count]:
            options = [o.strip() for o in item.options][:4]
            if len(options) != 4 or not 0 <= item.correct_index < 4:
                continue
            chunk = by_id.get(item.chunk_id) or chunks[0]
            matched = topic or match_topic(course, item.topic) or match_topic(course, chunk.location)
            questions.append(
                QuizQuestion(
                    question=item.question.strip(),
                    options=options,
                    correct_index=item.correct_index,
                    explanation=item.explanation.strip(),
                    topic_id=matched.id if matched else None,
                    citation=_cite(chunk, item.question + " " + options[item.correct_index]),
                )
            )
    except LLMUnavailable:
        questions = _offline_quiz(course, topic, chunks, count)
    if not questions:
        raise ValueError("Could not generate questions from the current material.")
    quiz = Quiz(tenant_id=course.tenant_id, course_id=course.id, topic_id=topic.id if topic else None, questions=questions)
    await get_store().put(course.tenant_id, QUIZZES, quiz.id, quiz.model_dump(mode="json"))
    return quiz


# ---------------------------------------------------------------- syllabus

SYLLABUS_PROMPT = """From the course material in the <source> blocks, list the 4-10 main topics a student must master,
in teaching order. Each topic is a short title (2-6 words)."""


async def generate_syllabus(course: Course) -> list[str]:
    chunks = await retrieve(course.tenant_id, course.title, app="study", scope=course.id, limit=12, min_score=0.0)
    if not chunks:
        raise ValueError("Upload course material first.")
    try:
        result = await complete_json(
            system=SYLLABUS_PROMPT,
            user=f"Course: {course.title}\n\nSources:\n{format_context(chunks)}",
            schema=GeneratedSyllabus,
        )
        return [t.strip() for t in result.topics if t.strip()][:10]
    except LLMUnavailable:
        seen: list[str] = []
        for chunk in chunks:
            label = chunk.location
            if not label.lower().startswith(("page", "slide", "row", "section")) and label not in seen:
                seen.append(label)
        return seen[:8] or [f"{c.source} · {c.location}" for c in chunks[:6]]
