import { useEffect, useMemo, useState } from "react";
import type { AnswerResult, Course, Quiz, QuizQuestion, Topic } from "../../shared/api/types";
import { useAgentAPI, useMutation, useResource } from "../../shared/hooks/useAgentAPI";
import { IconCheck, IconChevronRight, IconSparkle, IconX } from "../../shared/ui/icons";
import { Badge, Button, cx, InlineError, Progress, SectionHeader, Spinner } from "../../shared/ui/primitives";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function optionState(question: QuizQuestion, index: number): "idle" | "correct" | "wrong" | "dim" {
  if (question.answered_index === null || question.correct_index === null) return "idle";
  if (index === question.correct_index) return "correct";
  if (index === question.answered_index) return "wrong";
  return "dim";
}

export function QuizPanel({ course, topic, onCourse }: { course: Course; topic: Topic | null; onCourse: (c: Course) => void }) {
  const { request } = useAgentAPI();
  const quizzesPath = `/api/v1/study/courses/${course.id}/quizzes`;
  const quizzes = useResource<Quiz[]>(quizzesPath);
  const latest = useMemo(
    () => (quizzes.data ?? []).find((q) => (topic ? q.topic_id === topic.id : true)) ?? null,
    [quizzes.data, topic],
  );
  const [position, setPosition] = useState(0);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPosition(0), [latest?.id]);

  const generate = useMutation(async () => {
    const quiz = await request<Quiz>(`${quizzesPath}/generate`, { method: "POST", json: { topic_id: topic?.id ?? null, count: 5 } });
    quizzes.mutate((prev) => [quiz, ...(prev ?? [])]);
    setPosition(0);
    return quiz;
  });

  if (!latest) {
    return (
      <section aria-label="Quiz" className="flex min-h-0 flex-1 flex-col">
        <SectionHeader title="Quiz" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-xs text-ink-3">Test yourself{topic ? ` on ${topic.title}` : ""}.</p>
          <Button size="sm" variant="primary" icon={<IconSparkle size={12} />} loading={generate.status === "loading"} onClick={() => void generate.run()}>
            Generate quiz
          </Button>
          <InlineError message={generate.error?.message} />
        </div>
      </section>
    );
  }

  const questions = latest.questions;
  const question = questions[Math.min(position, questions.length - 1)];
  const answered = questions.filter((q) => q.answered_index !== null);
  const correctCount = answered.filter((q) => q.answered_index === q.correct_index).length;
  const finished = answered.length === questions.length;

  const answer = async (selected: number) => {
    if (question.answered_index !== null || pendingIndex !== null) return;
    setPendingIndex(selected);
    setError(null);
    try {
      const result = await request<AnswerResult>(`/api/v1/study/quizzes/${latest.id}/answer`, {
        method: "POST",
        json: { question_id: question.id, selected_index: selected },
      });
      quizzes.mutate((prev) =>
        (prev ?? []).map((quiz) =>
          quiz.id !== latest.id
            ? quiz
            : {
                ...quiz,
                questions: quiz.questions.map((q) =>
                  q.id === question.id
                    ? { ...q, answered_index: selected, correct_index: result.correct_index, explanation: result.explanation, citation: result.citation }
                    : q,
                ),
              },
        ),
      );
      if (result.topic_id) {
        onCourse({
          ...course,
          overall_mastery: result.course_mastery,
          topics: course.topics.map((t) =>
            t.id === result.topic_id
              ? { ...t, mastery: result.topic_mastery ?? t.mastery, attempts: t.attempts + 1, correct: t.correct + (result.correct ? 1 : 0) }
              : t,
          ),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingIndex(null);
    }
  };

  const isAnswered = question.answered_index !== null;
  const wasCorrect = isAnswered && question.answered_index === question.correct_index;

  return (
    <section aria-label="Quiz" className="flex min-h-0 flex-1 flex-col">
      <SectionHeader
        title="Quiz"
        meta={
          <span className="text-[11px] text-ink-4 tabular">
            {correctCount}/{answered.length} correct
          </span>
        }
        actions={
          <Button size="xs" variant="ghost" icon={<IconSparkle size={12} />} loading={generate.status === "loading"} onClick={() => void generate.run()}>
            New quiz
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center gap-1" aria-label="Question progress">
          {questions.map((q, i) => {
            const done = q.answered_index !== null;
            const ok = done && q.answered_index === q.correct_index;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setPosition(i)}
                aria-label={`Question ${i + 1}${done ? (ok ? ", correct" : ", incorrect") : ""}`}
                aria-current={i === position ? "step" : undefined}
                className={cx(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  done ? (ok ? "bg-emerald-500" : "bg-red-500") : "bg-zinc-800",
                  i === position && "ring-1 ring-zinc-400 ring-offset-1 ring-offset-canvas",
                )}
              />
            );
          })}
        </div>

        <div>
          <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4 tabular">
            Question {position + 1} of {questions.length}
          </p>
          <p className="mt-1 text-[13.5px] font-medium leading-snug text-ink">{question.question}</p>
        </div>

        <div className="space-y-1.5" role="radiogroup" aria-label="Answer options">
          {question.options.map((option, index) => {
            const state = optionState(question, index);
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={question.answered_index === index}
                disabled={isAnswered || pendingIndex !== null}
                onClick={() => void answer(index)}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-[6px] border px-3 py-2 text-left text-[12.5px] transition-colors",
                  state === "idle" && "border-line-strong text-ink-2 hover:border-zinc-600 hover:bg-zinc-900/50",
                  state === "correct" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-100",
                  state === "wrong" && "border-red-500/50 bg-red-500/10 text-red-100",
                  state === "dim" && "border-line text-ink-4",
                )}
              >
                <span
                  className={cx(
                    "mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[9.5px]",
                    state === "correct" ? "border-emerald-400 bg-emerald-500 text-zinc-950" : state === "wrong" ? "border-red-400 bg-red-500 text-white" : "border-line-strong text-ink-4",
                  )}
                >
                  {pendingIndex === index ? <Spinner size={9} /> : state === "correct" ? <IconCheck size={10} /> : state === "wrong" ? <IconX size={10} /> : LETTERS[index]}
                </span>
                <span className="leading-snug">{option}</span>
              </button>
            );
          })}
        </div>

        <InlineError message={error} />

        {isAnswered ? (
          <div
            role="status"
            className={cx(
              "animate-fade-in rounded-[6px] border p-3",
              wasCorrect ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-red-500/30 bg-red-500/[0.07]",
            )}
          >
            <div className="flex items-center gap-1.5">
              {wasCorrect ? <IconCheck size={13} className="text-emerald-400" /> : <IconX size={13} className="text-red-400" />}
              <span className={cx("text-[12px] font-semibold", wasCorrect ? "text-emerald-300" : "text-red-300")}>
                {wasCorrect ? "Correct" : `Incorrect — answer is ${LETTERS[question.correct_index ?? 0]}`}
              </span>
            </div>
            {question.explanation ? <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{question.explanation}</p> : null}
            {question.citation ? (
              <p className="mt-1.5 text-[10.5px] text-ink-4">
                Source: {question.citation.source} · {question.citation.location}
              </p>
            ) : null}
          </div>
        ) : null}

        {finished ? (
          <div className="rounded-[6px] border border-line bg-raised p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink">Quiz complete</span>
              <Badge tone={correctCount / questions.length >= 0.7 ? "ok" : "warn"}>
                {Math.round((correctCount / questions.length) * 100)}%
              </Badge>
            </div>
            <Progress value={correctCount / questions.length} tone={correctCount / questions.length >= 0.7 ? "ok" : "bad"} className="mt-2" />
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            size="sm"
            variant={isAnswered ? "primary" : "ghost"}
            disabled={position >= questions.length - 1}
            onClick={() => setPosition((p) => Math.min(questions.length - 1, p + 1))}
            icon={<IconChevronRight size={12} />}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
