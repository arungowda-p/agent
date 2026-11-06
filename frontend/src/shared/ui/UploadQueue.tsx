import type { Artifact } from "../api/types";
import { formatBytes, timeAgo, type UploadItem } from "../hooks/useAgentAPI";
import { IconAlert, IconCheck, IconFile, IconLink, IconTrash, IconX } from "./icons";
import { Badge, cx, IconButton, Progress, Spinner } from "./primitives";

const PHASE_LABEL: Record<UploadItem["phase"], string> = {
  uploading: "Uploading",
  queued: "Queued",
  processing: "Indexing",
  indexed: "Indexed",
  failed: "Failed",
};

/** Live queue rows: byte-level upload progress followed by indexing-job progress. */
export function UploadQueueList({ items, onCancel }: { items: UploadItem[]; onCancel: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-line" aria-label="Upload queue">
      {items.map((item) => {
        const uploading = item.phase === "uploading";
        const value = uploading ? (item.size ? item.loaded / item.size : 0) : item.indexProgress;
        const tone = item.phase === "failed" ? "bad" : item.phase === "indexed" ? "ok" : uploading ? "neutral" : "accent";
        return (
          <li key={item.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-ink-4">
                {item.phase === "indexed" ? (
                  <IconCheck size={13} className="text-emerald-400" />
                ) : item.phase === "failed" ? (
                  <IconAlert size={13} className="text-red-400" />
                ) : (
                  <Spinner size={12} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2" title={item.filename}>
                {item.filename}
              </span>
              <span className="text-[10.5px] text-ink-4 tabular">{formatBytes(item.size)}</span>
              {item.phase === "uploading" || item.phase === "failed" ? (
                <IconButton label={`Remove ${item.filename}`} onClick={() => onCancel(item.id)}>
                  <IconX size={12} />
                </IconButton>
              ) : null}
            </div>
            <Progress value={item.phase === "failed" ? 1 : value} tone={tone} className="mt-1.5" label={`${item.filename} progress`} />
            <div className="mt-1 flex items-center justify-between text-[10.5px]">
              <span className={cx(item.phase === "failed" ? "text-red-400" : "text-ink-4", "truncate")}>
                {item.error ?? item.message}
              </span>
              <span className="text-ink-4 tabular">
                {PHASE_LABEL[item.phase]} · {Math.round(value * 100)}%
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_TONE: Record<Artifact["status"], "ok" | "warn" | "bad" | "neutral" | "accent"> = {
  uploading: "neutral",
  queued: "neutral",
  processing: "accent",
  indexed: "ok",
  failed: "bad",
};

/** Persisted artifacts for a scope, with their server-side indexing status. */
export function ArtifactList({
  artifacts,
  onDelete,
  emptyLabel = "No documents yet",
}: {
  artifacts: Artifact[];
  onDelete?: (artifact: Artifact) => void;
  emptyLabel?: string;
}) {
  if (artifacts.length === 0) {
    return <p className="px-3 py-4 text-center text-[11px] text-ink-4">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="group flex items-center gap-2 px-3 py-2">
          <span className="text-ink-4">{artifact.source_url ? <IconLink size={13} /> : <IconFile size={13} />}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-ink-2" title={artifact.source_url ?? artifact.filename}>
              {artifact.filename}
            </p>
            <p className="text-[10.5px] text-ink-4 tabular">
              {artifact.chunk_count} chunks · {formatBytes(artifact.size_bytes)} · {timeAgo(artifact.created_at)}
            </p>
            {artifact.status === "processing" ? <Progress value={artifact.progress} tone="accent" className="mt-1" /> : null}
            {artifact.error ? <p className="truncate text-[10.5px] text-red-400">{artifact.error}</p> : null}
          </div>
          <Badge tone={STATUS_TONE[artifact.status]}>{artifact.status}</Badge>
          {onDelete ? (
            <IconButton
              label={`Delete ${artifact.filename}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100"
              onClick={() => onDelete(artifact)}
            >
              <IconTrash size={12} />
            </IconButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
