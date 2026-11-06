import { memo, useEffect, useMemo, useState } from "react";
import type { Confidence, Questionnaire, QuestionRow } from "../../shared/api/types";
import { IconCheck, IconChevronRight, IconDownload, IconRefresh, IconSparkle } from "../../shared/ui/icons";
import { Badge, Button, ConfidenceTag, cx, IconButton, Input, Progress, Spinner } from "../../shared/ui/primitives";
import type { Job } from "../../shared/api/types";

export type RowFilter = "all" | Exclude<Confidence, "pending"> | "pending" | "approved";

const FILTERS: { id: RowFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "review", label: "Review" },
  { id: "unsure", label: "Unsure" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
];

function matches(row: QuestionRow, filter: RowFilter, query: string): boolean {
  if (filter === "approved" && !row.approved) return false;
  if (filter !== "all" && filter !== "approved" && row.confidence !== filter) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    row.question.toLowerCase().includes(q) ||
    row.answer.toLowerCase().includes(q) ||
    row.ref.toLowerCase().includes(q) ||
    row.category.toLowerCase().includes(q)
  );
}

const AnswerCell = memo(function AnswerCell({
  row,
  onSave,
  busy,
}: {
  row: QuestionRow;
  onSave: (row: QuestionRow, answer: string) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(row.answer);
  useEffect(() => setDraft(row.answer), [row.answer]);
  const dirty = draft !== row.answer;
  return (
    <div className="relative">
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => dirty && onSave(row, draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            (event.target as HTMLTextAreaElement).blur();
          }
          if (event.key === "Escape") setDraft(row.answer);
        }}
        onClick={(event) => event.stopPropagation()}
        rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 48)))}
        placeholder={row.confidence === "pending" ? "Not drafted yet" : "Write an answer…"}
        aria-label={`Answer for ${row.ref}`}
        className={cx(
          "block w-full resize-y rounded-[4px] border bg-transparent px-2 py-1.5 text-[12.5px] leading-relaxed text-ink-2 placeholder:text-ink-4",
          "transition-colors hover:border-line-strong focus:border-focus focus:bg-canvas focus:outline-none",
          dirty ? "border-indigo-400/50" : "border-transparent",
        )}
      />
      {busy ? (
        <span className="absolute right-1.5 top-1.5 text-ink-4">
          <Spinner size={11} />
        </span>
      ) : null}
    </div>
  );
});

export function QuestionGrid({
  questionnaire,
  activeRowId,
  onOpenRow,
  onSaveAnswer,
  onToggleApprove,
  onRegenerate,
  onAutofill,
  onExport,
  job,
  busyRows,
}: {
  questionnaire: Questionnaire;
  activeRowId: string | null;
  onOpenRow: (rowId: string) => void;
  onSaveAnswer: (row: QuestionRow, answer: string) => void;
  onToggleApprove: (row: QuestionRow) => void;
  onRegenerate: (row: QuestionRow) => void;
  onAutofill: (overwrite: boolean) => void;
  onExport: () => void;
  job: Job | null;
  busyRows: Set<string>;
}) {
  const [filter, setFilter] = useState<RowFilter>("all");
  const [query, setQuery] = useState("");
  const rows = questionnaire.rows;
  const visible = useMemo(() => rows.filter((r) => matches(r, filter, query)), [rows, filter, query]);
  const counts = useMemo(() => {
    const c: Record<RowFilter, number> = { all: rows.length, high: 0, review: 0, unsure: 0, pending: 0, approved: 0 };
    rows.forEach((r) => {
      c[r.confidence] += 1;
      if (r.approved) c.approved += 1;
    });
    return c;
  }, [rows]);
  const running = !!job && (job.status === "queued" || job.status === "running");

  return (
    <section className="flex min-h-0 min-w-0 flex-col" aria-label="Questionnaire">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold tracking-tight text-ink">{questionnaire.name}</h1>
          <p className="text-[11px] text-ink-4 tabular">
            {questionnaire.customer || "No customer"} · {rows.length} questions · {counts.approved} approved
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<IconDownload size={13} />} onClick={onExport}>
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<IconRefresh size={13} />}
            disabled={running}
            onClick={() => onAutofill(true)}
            title="Re-draft every row, including edited ones"
          >
            Redraft all
          </Button>
          <Button size="sm" variant="primary" icon={<IconSparkle size={13} />} loading={running} onClick={() => onAutofill(false)}>
            {running ? "Drafting" : "Autofill"}
          </Button>
        </div>
        {running && job ? (
          <div className="flex w-full items-center gap-3">
            <Progress value={job.progress} tone="accent" label="Autofill progress" />
            <span className="shrink-0 text-[11px] text-ink-4 tabular">{job.message}</span>
          </div>
        ) : null}
        {job?.status === "failed" ? <p className="w-full text-[11px] text-red-400">Autofill failed: {job.error}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div role="radiogroup" aria-label="Filter by confidence" className="flex items-center gap-0.5 rounded-[5px] border border-line p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "inline-flex h-6 items-center gap-1 rounded-[3px] px-2 text-[11px] font-medium transition-colors",
                filter === f.id ? "bg-zinc-800 text-ink" : "text-ink-4 hover:text-ink-2",
              )}
            >
              {f.label}
              <span className="text-ink-4 tabular">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <Input
          placeholder="Search questions and answers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto h-7 max-w-64 text-xs"
          aria-label="Search rows"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-10 bg-canvas">
            <tr className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
              <th scope="col" className="w-16 border-b border-line px-4 py-2 font-medium">Ref</th>
              <th scope="col" className="w-[34%] border-b border-line px-2 py-2 font-medium">Question</th>
              <th scope="col" className="border-b border-line px-2 py-2 font-medium">Answer</th>
              <th scope="col" className="w-24 border-b border-line px-2 py-2 font-medium">Confidence</th>
              <th scope="col" className="w-24 border-b border-line px-2 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const active = row.id === activeRowId;
              return (
                <tr
                  key={row.id}
                  onClick={() => onOpenRow(row.id)}
                  className={cx(
                    "group cursor-pointer align-top transition-colors",
                    active ? "bg-indigo-500/[0.06]" : "hover:bg-zinc-900/40",
                  )}
                >
                  <td className={cx("border-b border-line py-2.5 pl-4 pr-2", active && "shadow-[inset_2px_0_0_#818cf8]")}>
                    <span className="font-mono text-[11px] text-ink-3">{row.ref}</span>
                  </td>
                  <td className="border-b border-line px-2 py-2.5">
                    <p className="text-[12.5px] leading-relaxed text-ink">{row.question}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge>{row.category}</Badge>
                      {row.edited ? <Badge tone="accent">Edited</Badge> : null}
                      {row.citations.length > 0 ? (
                        <span className="text-[10.5px] text-ink-4 tabular">{row.citations.length} sources</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="border-b border-line px-1 py-1.5">
                    <AnswerCell row={row} onSave={onSaveAnswer} busy={busyRows.has(row.id)} />
                  </td>
                  <td className="border-b border-line px-2 py-2.5">
                    <ConfidenceTag value={row.confidence} />
                  </td>
                  <td className="border-b border-line px-2 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton
                        label={row.approved ? "Unapprove" : "Approve"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleApprove(row);
                        }}
                        className={row.approved ? "text-emerald-400 hover:text-emerald-300" : undefined}
                      >
                        <IconCheck size={13} />
                      </IconButton>
                      <IconButton
                        label="Regenerate answer"
                        disabled={busyRows.has(row.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRegenerate(row);
                        }}
                      >
                        <IconRefresh size={13} />
                      </IconButton>
                      <IconButton label="Open sources" onClick={() => onOpenRow(row.id)}>
                        <IconChevronRight size={13} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? <p className="py-10 text-center text-xs text-ink-4">No rows match this filter.</p> : null}
      </div>
    </section>
  );
}
