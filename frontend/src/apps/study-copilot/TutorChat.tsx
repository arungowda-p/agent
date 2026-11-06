import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Citation, Course, StudyChatResponse, Topic } from "../../shared/api/types";
import { useAgentAPI, usePersistentState } from "../../shared/hooks/useAgentAPI";
import { IconBook, IconFile, IconSend, IconTrash } from "../../shared/ui/icons";
import { Badge, cx, EmptyState, IconButton, InlineError, SectionHeader, Spinner } from "../../shared/ui/primitives";

interface Turn extends ChatMessage {
  id: string;
  citations?: Citation[];
}

/** Turns "[1]" markers into superscript footnote buttons. */
function withFootnotes(text: string, citations: Citation[], onFocus: (index: number) => void): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part);
    if (match) {
      const index = Number(match[1]) - 1;
      if (citations[index]) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onFocus(index)}
            className="mx-px inline-flex h-[15px] min-w-[15px] -translate-y-1 items-center justify-center rounded-[3px] border border-indigo-400/40 bg-indigo-500/10 px-0.5 font-mono text-[9.5px] text-indigo-300 hover:bg-indigo-500/20"
            aria-label={`Footnote ${index + 1}: ${citations[index].source} ${citations[index].location}`}
          >
            {index + 1}
          </button>
        );
      }
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function AssistantTurn({ turn }: { turn: Turn }) {
  const [focused, setFocused] = useState<number | null>(null);
  const citations = turn.citations ?? [];
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const focus = (index: number) => {
    setFocused(index);
    refs.current[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  return (
    <div className="max-w-[720px]">
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{withFootnotes(turn.content, citations, focus)}</div>
      {citations.length > 0 ? (
        <ol className="mt-3 space-y-1 border-t border-line pt-2">
          {citations.map((citation, index) => (
            <li
              key={`${citation.chunk_id}-${index}`}
              ref={(el) => {
                refs.current[index] = el;
              }}
              className={cx(
                "flex gap-2 rounded-[4px] px-2 py-1.5 text-[11.5px] transition-colors",
                focused === index ? "bg-indigo-500/10" : "hover:bg-zinc-900/50",
              )}
            >
              <span className="w-4 shrink-0 font-mono text-[10.5px] text-ink-4">{index + 1}.</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <IconFile size={11} className="text-ink-4" />
                  <span className="truncate text-ink-3">{citation.source}</span>
                  <Badge>{citation.location}</Badge>
                </div>
                <p className="mt-0.5 text-ink-4">“{citation.quote}”</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function TutorChat({ course, topic }: { course: Course; topic: Topic | null }) {
  const { request } = useAgentAPI();
  const [turns, setTurns] = usePersistentState<Turn[]>(`study:chat:${course.id}`, []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    const next = [...turns, { id: crypto.randomUUID(), role: "user" as const, content }];
    setTurns(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await request<StudyChatResponse>(`/api/v1/study/courses/${course.id}/chat`, {
        method: "POST",
        json: { topic_id: topic?.id ?? null, messages: next.slice(-12).map(({ role, content: c }) => ({ role, content: c })) },
      });
      setTurns((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: reply.answer, citations: reply.citations }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const suggestions = topic
    ? [`Explain ${topic.title} simply`, `What are the key terms in ${topic.title}?`, `Give me an example of ${topic.title}`]
    : ["Summarise the main ideas of this course", "What should I review first?", "Explain the hardest concept"];

  return (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label="Tutor chat">
      <SectionHeader
        title="Tutor"
        meta={topic ? <Badge tone="accent">{topic.title}</Badge> : <Badge>All topics</Badge>}
        actions={
          turns.length > 0 ? (
            <IconButton label="Clear conversation" onClick={() => setTurns([])}>
              <IconTrash size={12} />
            </IconButton>
          ) : null
        }
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
        {turns.length === 0 ? (
          <EmptyState
            icon={<IconBook size={22} />}
            title={`Ask about ${course.title}`}
            body="Answers come only from your uploaded slides and notes, with footnotes linking back to the exact slide."
            action={
              <div className="flex flex-wrap justify-center gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="rounded-[5px] border border-line-strong px-2 py-1 text-[11.5px] text-ink-3 hover:border-zinc-600 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          <div className="space-y-5">
            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-[8px] border border-line-strong bg-raised px-3 py-2 text-[13px] text-ink">{turn.content}</p>
                </div>
              ) : (
                <AssistantTurn key={turn.id} turn={turn} />
              ),
            )}
            {sending ? (
              <div className="flex items-center gap-2 text-xs text-ink-4">
                <Spinner size={12} /> Searching your material…
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <InlineError message={error} />
        <form
          className="relative mt-0 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={topic ? `Ask about ${topic.title}…` : "Ask a question about your course…"}
            aria-label="Message the tutor"
            className="min-h-[52px] w-full resize-none rounded-[6px] border border-line-strong bg-canvas px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-focus focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || sending}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-zinc-100 text-zinc-950 hover:bg-white disabled:opacity-30"
          >
            <IconSend size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
