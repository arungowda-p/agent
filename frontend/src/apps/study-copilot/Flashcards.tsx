import { useCallback, useEffect, useMemo, useState } from "react";
import type { Course, Flashcard, Topic } from "../../shared/api/types";
import { useAgentAPI, useMutation, useResource } from "../../shared/hooks/useAgentAPI";
import { IconChevronRight, IconFlip, IconSparkle } from "../../shared/ui/icons";
import { Badge, Button, cx, IconButton, InlineError, Kbd, SectionHeader } from "../../shared/ui/primitives";

const GRADES: { id: Flashcard["last_grade"] & string; label: string; key: string; className: string }[] = [
  { id: "again", label: "Again", key: "1", className: "border-red-500/30 text-red-300 hover:bg-red-500/10" },
  { id: "good", label: "Good", key: "2", className: "border-line-strong text-ink-2 hover:bg-zinc-900" },
  { id: "easy", label: "Easy", key: "3", className: "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10" },
];

export function Flashcards({ course, topic, onCourse }: { course: Course; topic: Topic | null; onCourse: (c: Course) => void }) {
  const { request } = useAgentAPI();
  const path = `/api/v1/study/courses/${course.id}/flashcards${topic ? `?topic_id=${topic.id}` : ""}`;
  const deck = useResource<Flashcard[]>(path);
  const cards = useMemo(() => deck.data ?? [], [deck.data]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [path]);

  const card = cards[Math.min(index, Math.max(0, cards.length - 1))];

  const generate = useMutation(async () => {
    const created = await request<Flashcard[]>(`/api/v1/study/courses/${course.id}/flashcards/generate`, {
      method: "POST",
      json: { topic_id: topic?.id ?? null, count: 8 },
    });
    deck.mutate((prev) => [...created, ...(prev ?? [])]);
    setIndex(0);
    setFlipped(false);
    return created;
  });

  const grade = useCallback(
    async (value: "again" | "good" | "easy") => {
      if (!card) return;
      const updatedCourse = await request<Course>(`/api/v1/study/flashcards/${card.id}/review`, {
        method: "POST",
        json: { grade: value },
      });
      onCourse(updatedCourse);
      deck.mutate((prev) => (prev ?? []).map((c) => (c.id === card.id ? { ...c, reviews: c.reviews + 1, last_grade: value } : c)));
      setFlipped(false);
      window.setTimeout(() => setIndex((i) => (cards.length ? (i + 1) % cards.length : 0)), 120);
    },
    [card, cards.length, request, onCourse, deck],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!card) return;
      if (event.key === " ") {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["1", "2", "3"].includes(event.key)) {
        void grade(GRADES[Number(event.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, flipped, grade]);

  return (
    <section aria-label="Flashcards" className="flex flex-col border-b border-line">
      <SectionHeader
        title="Flashcards"
        meta={<span className="text-[11px] text-ink-4 tabular">{cards.length ? `${index + 1}/${cards.length}` : "0"}</span>}
        actions={
          <Button size="xs" variant="ghost" icon={<IconSparkle size={12} />} loading={generate.status === "loading"} onClick={() => void generate.run()}>
            Generate
          </Button>
        }
      />
      <div className="space-y-3 p-3">
        <InlineError message={generate.error?.message} />
        {card ? (
          <>
            <div className="perspective-card">
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                aria-label={flipped ? "Show question" : "Reveal answer"}
                aria-pressed={flipped}
                className={cx(
                  "preserve-3d relative block h-48 w-full text-left transition-transform duration-500 [transition-timing-function:cubic-bezier(0.2,0.8,0.2,1)]",
                  flipped && "rotate-y-180",
                )}
              >
                <div className="backface-hidden absolute inset-0 flex flex-col rounded-[8px] border border-line-strong bg-gradient-to-b from-raised to-canvas p-4 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-[0.1em] text-ink-4">Question</span>
                    {card.last_grade ? <Badge tone={card.last_grade === "again" ? "bad" : card.last_grade === "easy" ? "ok" : "neutral"}>{card.last_grade}</Badge> : null}
                  </div>
                  <p className="my-auto text-[14px] font-medium leading-snug text-ink">{card.front}</p>
                  <span className="flex items-center gap-1 text-[10.5px] text-ink-4">
                    <IconFlip size={11} /> Click or <Kbd>Space</Kbd> to flip
                  </span>
                </div>
                <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col rounded-[8px] border border-indigo-400/30 bg-gradient-to-b from-[#12121a] to-canvas p-4 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]">
                  <span className="text-[10px] uppercase tracking-[0.1em] text-indigo-300/80">Answer</span>
                  <p className="my-auto text-[13.5px] leading-relaxed text-ink">{card.back}</p>
                  {card.citation ? (
                    <span className="truncate text-[10.5px] text-ink-4">
                      {card.citation.source} · {card.citation.location}
                    </span>
                  ) : null}
                </div>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <IconButton label="Previous card" onClick={() => { setFlipped(false); setIndex((i) => (i - 1 + cards.length) % cards.length); }}>
                <IconChevronRight size={13} className="rotate-180" />
              </IconButton>
              <div className={cx("grid flex-1 grid-cols-3 gap-1.5 transition-opacity", !flipped && "pointer-events-none opacity-30")}>
                {GRADES.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={!flipped}
                    onClick={() => void grade(g.id)}
                    className={cx("inline-flex h-7 items-center justify-center gap-1.5 rounded-[5px] border text-[11.5px] font-medium transition-colors", g.className)}
                  >
                    {g.label}
                    <span className="font-mono text-[9.5px] opacity-50">{g.key}</span>
                  </button>
                ))}
              </div>
              <IconButton label="Next card" onClick={() => { setFlipped(false); setIndex((i) => (i + 1) % cards.length); }}>
                <IconChevronRight size={13} />
              </IconButton>
            </div>
          </>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-line-strong text-center">
            <p className="text-xs text-ink-3">No cards{topic ? ` for ${topic.title}` : ""} yet.</p>
            <p className="max-w-56 text-[11px] text-ink-4">Generate a deck from your uploaded material.</p>
          </div>
        )}
      </div>
    </section>
  );
}
