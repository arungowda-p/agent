from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from ...core.models import Citation, new_id, utcnow


class Topic(BaseModel):
    id: str = Field(default_factory=lambda: new_id("top"))
    title: str
    order: int = 0
    mastery: float = 0.0
    attempts: int = 0
    correct: int = 0
    cards_reviewed: int = 0


class Course(BaseModel):
    id: str = Field(default_factory=lambda: new_id("crs"))
    tenant_id: str
    title: str
    code: str = ""
    topics: list[Topic] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @property
    def mastery(self) -> float:
        return round(sum(t.mastery for t in self.topics) / len(self.topics), 3) if self.topics else 0.0


class CourseOut(Course):
    overall_mastery: float = 0.0

    @classmethod
    def from_course(cls, course: Course) -> "CourseOut":
        return cls(**course.model_dump(), overall_mastery=course.mastery)


class CourseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    code: str = Field(default="", max_length=20)
    topics: list[str] = Field(default_factory=list, max_length=60)


class TopicCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class TopicPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    order: int | None = None


class Flashcard(BaseModel):
    id: str = Field(default_factory=lambda: new_id("card"))
    tenant_id: str
    course_id: str
    topic_id: str | None = None
    front: str
    back: str
    citation: Citation | None = None
    reviews: int = 0
    last_grade: Literal["again", "good", "easy"] | None = None
    created_at: datetime = Field(default_factory=utcnow)


class QuizQuestion(BaseModel):
    id: str = Field(default_factory=lambda: new_id("qq"))
    question: str
    options: list[str]
    correct_index: int
    explanation: str
    topic_id: str | None = None
    citation: Citation | None = None
    answered_index: int | None = None


class Quiz(BaseModel):
    id: str = Field(default_factory=lambda: new_id("quiz"))
    tenant_id: str
    course_id: str
    topic_id: str | None = None
    questions: list[QuizQuestion]
    created_at: datetime = Field(default_factory=utcnow)


class QuizQuestionPublic(BaseModel):
    id: str
    question: str
    options: list[str]
    topic_id: str | None
    answered_index: int | None
    correct_index: int | None = Field(default=None, description="Only revealed after answering.")
    explanation: str | None = None
    citation: Citation | None = None


class QuizPublic(BaseModel):
    id: str
    course_id: str
    topic_id: str | None
    questions: list[QuizQuestionPublic]
    created_at: datetime

    @classmethod
    def from_quiz(cls, quiz: Quiz) -> "QuizPublic":
        return cls(
            id=quiz.id,
            course_id=quiz.course_id,
            topic_id=quiz.topic_id,
            created_at=quiz.created_at,
            questions=[
                QuizQuestionPublic(
                    id=q.id,
                    question=q.question,
                    options=q.options,
                    topic_id=q.topic_id,
                    answered_index=q.answered_index,
                    correct_index=q.correct_index if q.answered_index is not None else None,
                    explanation=q.explanation if q.answered_index is not None else None,
                    citation=q.citation if q.answered_index is not None else None,
                )
                for q in quiz.questions
            ],
        )


class GenerateRequest(BaseModel):
    topic_id: str | None = None
    count: int = Field(default=6, ge=1, le=15)


class ReviewRequest(BaseModel):
    grade: Literal["again", "good", "easy"]


class AnswerRequest(BaseModel):
    question_id: str
    selected_index: int = Field(ge=0, le=5)


class AnswerResult(BaseModel):
    correct: bool
    correct_index: int
    explanation: str
    citation: Citation | None
    topic_id: str | None
    topic_mastery: float | None
    course_mastery: float


class StudyMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class StudyChatRequest(BaseModel):
    messages: list[StudyMessage] = Field(min_length=1, max_length=30)
    topic_id: str | None = None


class StudyChatResponse(BaseModel):
    answer: str
    citations: list[Citation]


# ---------- structured-output contracts


class CitedQuote(BaseModel):
    chunk_id: str
    quote: str


class TutorReply(BaseModel):
    answer: str = Field(description="Explanation using footnote markers like [1], [2] matching the citations order.")
    citations: list[CitedQuote]


class GeneratedCard(BaseModel):
    front: str
    back: str
    topic: str
    chunk_id: str


class GeneratedDeck(BaseModel):
    cards: list[GeneratedCard]


class GeneratedQuestion(BaseModel):
    question: str
    options: list[str] = Field(description="Exactly 4 options.")
    correct_index: int
    explanation: str
    topic: str
    chunk_id: str


class GeneratedQuiz(BaseModel):
    questions: list[GeneratedQuestion]


class GeneratedSyllabus(BaseModel):
    topics: list[str]
