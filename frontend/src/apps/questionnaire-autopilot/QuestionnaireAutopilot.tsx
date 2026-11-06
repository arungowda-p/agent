import { useCallback, useState } from "react";
import type { AutofillResponse, Confidence, Questionnaire, QuestionRow, RowPatch } from "../../shared/api/types";
import { useAgentAPI, useJobPoller, usePersistentState, useResource } from "../../shared/hooks/useAgentAPI";
import { IconShield } from "../../shared/ui/icons";
import { cx, EmptyState, Flash, InlineError, Spinner, useFlash } from "../../shared/ui/primitives";
import { IngestionQueue, LIST_PATH } from "./IngestionQueue";
import { QuestionGrid } from "./QuestionGrid";
import { VerificationDrawer } from "./VerificationDrawer";

export default function QuestionnaireAutopilot() {
  const { request, invalidate } = useAgentAPI();
  const [selectedId, setSelectedId] = usePersistentState<string | null>("qa:selected", null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busyRows, setBusyRows] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [flashMessage, flash] = useFlash();

  const path = selectedId ? `${LIST_PATH}/${selectedId}` : null;
  const { job, active: jobRunning } = useJobPoller(jobId, {
    onSettled: (settled) => {
      invalidate(LIST_PATH);
      if (settled.status === "succeeded") flash(`Drafted ${String(settled.result?.answered ?? 0)} answers`);
    },
  });
  const questionnaire = useResource<Questionnaire>(path, { pollMs: jobRunning ? 1500 : undefined });

  const setBusy = (rowId: string, busy: boolean) =>
    setBusyRows((prev) => {
      const next = new Set(prev);
      if (busy) next.add(rowId);
      else next.delete(rowId);
      return next;
    });

  const replaceRow = useCallback(
    (updated: QuestionRow) =>
      questionnaire.mutate((prev) =>
        prev ? { ...prev, rows: prev.rows.map((r) => (r.id === updated.id ? updated : r)) } : (prev as unknown as Questionnaire),
      ),
    [questionnaire],
  );

  const patchRow = useCallback(
    async (row: QuestionRow, changes: RowPatch, optimistic: Partial<QuestionRow>) => {
      if (!selectedId) return;
      setError(null);
      replaceRow({ ...row, ...optimistic });
      setBusy(row.id, true);
      try {
        const updated = await request<QuestionRow>(`${LIST_PATH}/${selectedId}/rows/${row.id}`, {
          method: "PATCH",
          json: changes,
        });
        replaceRow(updated);
        invalidate(LIST_PATH);
      } catch (err) {
        replaceRow(row);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(row.id, false);
      }
    },
    [selectedId, request, replaceRow, invalidate],
  );

  const saveAnswer = useCallback(
    (row: QuestionRow, answer: string) => void patchRow(row, { answer }, { answer, edited: true }),
    [patchRow],
  );
  const toggleApprove = useCallback(
    (row: QuestionRow) => void patchRow(row, { approved: !row.approved }, { approved: !row.approved }),
    [patchRow],
  );
  const setConfidence = useCallback(
    (row: QuestionRow, confidence: Exclude<Confidence, "pending">) => void patchRow(row, { confidence }, { confidence }),
    [patchRow],
  );

  const regenerate = useCallback(
    async (row: QuestionRow) => {
      if (!selectedId) return;
      setBusy(row.id, true);
      setError(null);
      try {
        replaceRow(await request<QuestionRow>(`${LIST_PATH}/${selectedId}/rows/${row.id}/regenerate`, { method: "POST" }));
        invalidate(LIST_PATH);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(row.id, false);
      }
    },
    [selectedId, request, replaceRow, invalidate],
  );

  const autofill = useCallback(
    async (overwrite: boolean) => {
      if (!selectedId) return;
      setError(null);
      try {
        const response = await request<AutofillResponse>(`${LIST_PATH}/${selectedId}/autofill`, {
          method: "POST",
          json: { overwrite_edited: overwrite },
        });
        setJobId(response.job.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId, request],
  );

  const exportCsv = useCallback(async () => {
    if (!selectedId || !questionnaire.data) return;
    const csv = await request<string>(`${LIST_PATH}/${selectedId}/export.csv`, { headers: { Accept: "text/csv" } });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${questionnaire.data.name.replace(/[^\w.-]+/g, "_")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    flash("CSV exported");
  }, [selectedId, questionnaire.data, request, flash]);

  const activeRow = questionnaire.data?.rows.find((r) => r.id === activeRowId) ?? null;

  return (
    <div
      className={cx(
        "grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-1",
        activeRow ? "lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_400px]" : "lg:grid-cols-[280px_minmax(0,1fr)]",
      )}
    >
      <IngestionQueue
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setActiveRowId(null);
          setJobId(null);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-col">
        {error ? (
          <div className="border-b border-line p-2">
            <InlineError message={error} />
          </div>
        ) : null}
        {!selectedId ? (
          <EmptyState
            icon={<IconShield size={22} />}
            title="Select or create a questionnaire"
            body="Upload your policies and past answers to the knowledge library, then import a security questionnaire to auto-draft grounded answers."
          />
        ) : questionnaire.data ? (
          <QuestionGrid
            questionnaire={questionnaire.data}
            activeRowId={activeRowId}
            onOpenRow={setActiveRowId}
            onSaveAnswer={saveAnswer}
            onToggleApprove={toggleApprove}
            onRegenerate={(row) => void regenerate(row)}
            onAutofill={(overwrite) => void autofill(overwrite)}
            onExport={() => void exportCsv()}
            job={job}
            busyRows={busyRows}
          />
        ) : questionnaire.error ? (
          <div className="p-4">
            <InlineError message={questionnaire.error.message} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-ink-4">
            <Spinner />
          </div>
        )}
      </div>

      {activeRow ? (
        <VerificationDrawer
          row={activeRow}
          onClose={() => setActiveRowId(null)}
          onApprove={toggleApprove}
          onSetConfidence={setConfidence}
        />
      ) : null}
      <Flash message={flashMessage} />
    </div>
  );
}
