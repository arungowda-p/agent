import { useEffect, useMemo, type ReactNode } from "react";
import type { Confidence, QuestionRow, RetrievedChunk } from "../../shared/api/types";
import { useResource } from "../../shared/hooks/useAgentAPI";
import { IconAlert, IconCheck, IconFile, IconX } from "../../shared/ui/icons";
import { Badge, Button, ConfidenceTag, cx, IconButton, Spinner } from "../../shared/ui/primitives";

function highlight(text: string, quote: string): ReactNode {
  const needle = quote.replace(/…$/, "").trim();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase().slice(0, Math.min(needle.length, 160)));
  if (index === -1) return text;
  const end = index + Math.min(needle.length, text.length - index);
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[2px] bg-amber-300/15 px-0.5 text-amber-100 shadow-[inset_0_-1px_0_rgb(252_211_77/0.6)]">
        {text.slice(index, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

const CONFIDENCE_OPTIONS: Exclude<Confidence, "pending">[] = ["high", "review", "unsure"];

export function VerificationDrawer({
  row,
  onClose,
  onApprove,
  onSetConfidence,
}: {
  row: QuestionRow;
  onClose: () => void;
  onApprove: (row: QuestionRow) => void;
  onSetConfidence: (row: QuestionRow, value: Exclude<Confidence, "pending">) => void;
}) {
  const ids = useMemo(() => row.citations.map((c) => c.chunk_id).join(","), [row.citations]);
  const chunks = useResource<RetrievedChunk[]>(ids ? `/api/v1/artifacts/chunks?ids=${ids}` : null);
  const byId = useMemo(() => new Map((chunks.data ?? []).map((c) => [c.id, c])), [chunks.data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label="Verification drawer"
      className="flex min-h-0 animate-drawer-in flex-col border-l border-line bg-surface max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:top-11 max-xl:z-30 max-xl:w-[min(420px,100vw)] max-xl:shadow-2xl max-xl:shadow-black/80"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-ink-3">{row.ref}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Verification</span>
        </div>
        <IconButton label="Close drawer (Esc)" onClick={onClose}>
          <IconX size={13} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-line p-4">
          <p className="text-[13px] leading-relaxed text-ink">{row.question}</p>
          <div className="rounded-[6px] border border-line bg-canvas p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4">Drafted answer</span>
              <ConfidenceTag value={row.confidence} />
            </div>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{row.answer || "—"}</p>
            {row.reasoning ? <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-4">{row.reasoning}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-4">Set confidence</span>
            {CONFIDENCE_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSetConfidence(row, value)}
                aria-pressed={row.confidence === value}
                className={cx(
                  "rounded-[4px] border px-1.5 py-0.5 text-[11px] capitalize transition-colors",
                  row.confidence === value ? "border-zinc-500 text-ink" : "border-line text-ink-4 hover:text-ink-2",
                )}
              >
                {value}
              </button>
            ))}
            <Button
              size="xs"
              variant={row.approved ? "secondary" : "primary"}
              icon={<IconCheck size={12} />}
              className="ml-auto"
              onClick={() => onApprove(row)}
            >
              {row.approved ? "Approved" : "Approve"}
            </Button>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Grounding citations</h3>
            <span className="text-[11px] text-ink-4 tabular">{row.citations.length}</span>
          </div>
          {row.citations.length === 0 ? (
            <div className="flex items-start gap-2 rounded-[6px] border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
              <IconAlert size={13} className="mt-px shrink-0" />
              No supporting evidence. Upload a policy that covers this control or answer manually.
            </div>
          ) : null}
          <ol className="space-y-3">
            {row.citations.map((citation, index) => {
              const chunk = byId.get(citation.chunk_id);
              return (
                <li key={`${citation.chunk_id}-${index}`} className="overflow-hidden rounded-[6px] border border-line">
                  <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-1.5">
                    <span className="font-mono text-[10.5px] text-ink-4">[{index + 1}]</span>
                    <IconFile size={12} className="text-ink-4" />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{citation.source}</span>
                    <Badge>{citation.location}</Badge>
                  </div>
                  <div className="max-h-56 overflow-y-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-3">
                    {chunk ? (
                      <p className="whitespace-pre-wrap">{highlight(chunk.text, citation.quote)}</p>
                    ) : chunks.status === "loading" ? (
                      <Spinner size={12} />
                    ) : (
                      <p className="italic">“{citation.quote}”</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </aside>
  );
}
