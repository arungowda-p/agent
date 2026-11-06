import { useState } from "react";
import type { Artifact, Questionnaire, QuestionnaireSummary } from "../../shared/api/types";
import { timeAgo, useAgentAPI, useMutation, useResource, useUploadQueue } from "../../shared/hooks/useAgentAPI";
import { IconFile, IconPlus, IconTrash, IconUpload } from "../../shared/ui/icons";
import {
  Button,
  cx,
  Dropzone,
  IconButton,
  InlineError,
  Input,
  Progress,
  SectionHeader,
  Textarea,
} from "../../shared/ui/primitives";
import { ArtifactList, UploadQueueList } from "../../shared/ui/UploadQueue";

export const LIBRARY_PATH = "/api/v1/artifacts?app=questionnaire&scope=library";
export const LIST_PATH = "/api/v1/questionnaire/questionnaires";

function parsePasted(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 3)
    .map((line, index) => {
      // Accept "1.2<TAB>Category<TAB>Question" or plain "Question" lines.
      const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) return { ref: parts[0], category: parts[1], question: parts.slice(2).join(" ") };
      if (parts.length === 2) return { ref: parts[0], category: "General", question: parts[1] };
      return { ref: `Q${index + 1}`, category: "General", question: line };
    });
}

function NewQuestionnaire({ onCreated }: { onCreated: (id: string) => void }) {
  const { request, streamUpload, invalidate } = useAgentAPI();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [pasted, setPasted] = useState("");
  const [importProgress, setImportProgress] = useState<number | null>(null);

  const create = useMutation(async () => {
    const questions = parsePasted(pasted);
    if (questions.length === 0) throw new Error("Paste at least one question.");
    return request<Questionnaire>(LIST_PATH, {
      method: "POST",
      json: { name: name || "Untitled questionnaire", customer, questions },
    });
  });

  const importFile = useMutation(async (file: File) => {
    setImportProgress(0);
    try {
      return await streamUpload<Questionnaire>(file, {
        path: `${LIST_PATH}/import`,
        headers: {
          "X-Questionnaire-Name": encodeURIComponent(name),
          "X-Customer": encodeURIComponent(customer),
        },
        onProgress: (event) => setImportProgress(event.ratio),
      });
    } finally {
      setImportProgress(null);
    }
  });

  const finish = (questionnaire: Questionnaire | undefined) => {
    if (!questionnaire) return;
    invalidate(LIST_PATH);
    onCreated(questionnaire.id);
    setOpen(false);
    setName("");
    setCustomer("");
    setPasted("");
  };

  if (!open) {
    return (
      <Button size="xs" variant="ghost" icon={<IconPlus size={12} />} onClick={() => setOpen(true)}>
        New
      </Button>
    );
  }

  return (
    <div className="absolute inset-x-0 top-9 z-20 animate-fade-in border-b border-line bg-surface p-3 shadow-2xl shadow-black/70">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Questionnaire name" />
          <Input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" />
        </div>
        <Textarea
          rows={5}
          placeholder={"Paste questions, one per line.\nOptional: Ref<TAB>Category<TAB>Question"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          aria-label="Questions"
          className="font-mono text-[11.5px]"
        />
        <Dropzone
          compact
          accept=".xlsx,.csv,.docx,.pdf,.txt,.md"
          label="…or import XLSX / CSV / DOCX"
          hint="Rows ending with '?' become questions"
          onFiles={(files) => void importFile.run(files[0]).then(finish)}
          disabled={importProgress !== null}
        />
        {importProgress !== null ? <Progress value={importProgress} label="Import progress" /> : null}
        <InlineError message={create.error?.message ?? importFile.error?.message} />
        <div className="flex justify-end gap-1.5">
          <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="xs"
            variant="primary"
            loading={create.status === "loading"}
            disabled={!pasted.trim()}
            onClick={() => void create.run().then(finish)}
          >
            Create · {parsePasted(pasted).length}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function IngestionQueue({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { request, invalidate } = useAgentAPI();
  const library = useResource<Artifact[]>(LIBRARY_PATH);
  const anyProcessing = library.data?.some((a) => a.status === "queued" || a.status === "processing");
  useResource<Artifact[]>(anyProcessing ? LIBRARY_PATH : null, { pollMs: 1500 });
  const questionnaires = useResource<QuestionnaireSummary[]>(LIST_PATH);

  const queue = useUploadQueue({
    app: "questionnaire",
    scope: "library",
    onIndexed: () => invalidate(LIBRARY_PATH),
  });

  const removeArtifact = async (artifact: Artifact) => {
    library.mutate((prev) => (prev ?? []).filter((a) => a.id !== artifact.id));
    await request(`/api/v1/artifacts/${artifact.id}`, { method: "DELETE" });
    invalidate(LIBRARY_PATH);
  };

  const removeQuestionnaire = async (id: string) => {
    questionnaires.mutate((prev) => (prev ?? []).filter((q) => q.id !== id));
    await request(`${LIST_PATH}/${id}`, { method: "DELETE" });
    if (selectedId === id) onSelect(null);
    invalidate(LIST_PATH);
  };

  const indexedCount = library.data?.filter((a) => a.status === "indexed").length ?? 0;
  const chunkCount = library.data?.reduce((sum, a) => sum + a.chunk_count, 0) ?? 0;

  return (
    <aside className="flex min-h-0 flex-col border-line bg-surface lg:border-r" aria-label="Ingestion queue">
      <div className="relative flex min-h-0 flex-[0_1_auto] flex-col">
        <SectionHeader
          title="Questionnaires"
          meta={<span className="text-[11px] text-ink-4 tabular">{questionnaires.data?.length ?? 0}</span>}
          actions={<NewQuestionnaire onCreated={(id) => onSelect(id)} />}
        />
        <ul className="max-h-[38vh] overflow-y-auto">
          {(questionnaires.data ?? []).map((q) => {
            const done = q.total ? q.approved / q.total : 0;
            return (
              <li key={q.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(q.id)}
                  aria-current={q.id === selectedId ? "true" : undefined}
                  className={cx(
                    "block w-full border-l-2 px-3 py-2 text-left transition-colors",
                    q.id === selectedId ? "border-l-indigo-400 bg-zinc-900/70" : "border-l-transparent hover:bg-zinc-900/40",
                  )}
                >
                  <div className="flex items-center gap-2 pr-6">
                    <IconFile size={12} className="shrink-0 text-ink-4" />
                    <span className="truncate text-xs font-medium text-ink">{q.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10.5px] text-ink-4 tabular">
                    <span>{q.customer || "—"}</span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-emerald-400">{q.high}</span>
                    <span className="text-amber-300">{q.review}</span>
                    <span className="text-red-400">{q.unsure}</span>
                    <span className="ml-auto">
                      {q.approved}/{q.total}
                    </span>
                  </div>
                  <Progress value={done} tone="ok" className="mt-1.5" label={`${q.name} approval progress`} />
                </button>
                <IconButton
                  label={`Delete ${q.name}`}
                  className="absolute right-2 top-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => void removeQuestionnaire(q.id)}
                >
                  <IconTrash size={12} />
                </IconButton>
              </li>
            );
          })}
          {questionnaires.status === "success" && (questionnaires.data?.length ?? 0) === 0 ? (
            <li className="px-3 py-4 text-center text-[11px] text-ink-4">Create or import a questionnaire.</li>
          ) : null}
        </ul>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-line">
        <SectionHeader
          title="Knowledge library"
          meta={
            <span className="text-[11px] text-ink-4 tabular">
              {indexedCount} docs · {chunkCount} chunks
            </span>
          }
          actions={
            queue.items.some((i) => i.phase === "indexed" || i.phase === "failed") ? (
              <Button size="xs" variant="ghost" onClick={queue.clearFinished}>
                Clear
              </Button>
            ) : null
          }
        />
        <div className="p-3">
          <Dropzone
            accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.html,.pptx"
            label="Policies, SOC reports, past answers"
            hint="PDF · DOCX · XLSX · CSV · MD — 25 MB max"
            onFiles={queue.enqueue}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <UploadQueueList items={queue.items} onCancel={queue.cancel} />
          {queue.items.length > 0 ? <div className="h-px bg-line" /> : null}
          <ArtifactList
            artifacts={library.data ?? []}
            onDelete={(a) => void removeArtifact(a)}
            emptyLabel="Upload evidence documents to ground answers."
          />
        </div>
        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[10.5px] text-ink-4">
          <IconUpload size={11} />
          Streams in 1 MB chunks · last sync {timeAgo(library.updatedAt)}
        </div>
      </div>
    </aside>
  );
}
