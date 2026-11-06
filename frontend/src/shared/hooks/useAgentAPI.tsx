// Data layer for the Agent Suite: tenant-aware fetch, persistent SWR cache, streaming uploads
// with progress events, and a shared polling ticker for long-running indexing jobs.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AppName, Job, UploadResponse } from "../api/types";

const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const STORAGE_PREFIX = "agent-suite";

// ---------------------------------------------------------------- errors

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string; loc?: (string | number)[] };
    const field = first.loc ? first.loc.slice(1).join(".") : "";
    return field ? `${field}: ${first.msg ?? fallback}` : (first.msg ?? fallback);
  }
  return fallback;
}

// ---------------------------------------------------------------- persistent state

function readStorage<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (value === undefined) window.localStorage.removeItem(`${STORAGE_PREFIX}:${key}`);
    else window.localStorage.setItem(`${STORAGE_PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // Storage may be full or disabled (private mode); the in-memory value still works.
  }
}

export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStorage<T>(key) ?? initial);
  const keyRef = useRef(key);

  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(readStorage<T>(key) ?? initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeStorage(keyRef.current, resolved);
        return resolved;
      });
    },
    [],
  );
  return [value, update];
}

// ---------------------------------------------------------------- SWR cache

interface CacheEntry {
  data: unknown;
  updatedAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const listeners = new Set<(key: string) => void>();
let cacheVersion = 0;

function cacheGet(key: string): CacheEntry | undefined {
  const hit = memoryCache.get(key);
  if (hit) return hit;
  const persisted = readStorage<CacheEntry>(`cache:${key}`);
  if (persisted) memoryCache.set(key, persisted);
  return persisted;
}

function cacheSet(key: string, data: unknown, persist: boolean): void {
  const entry = { data, updatedAt: Date.now() };
  memoryCache.set(key, entry);
  if (persist) writeStorage(`cache:${key}`, entry);
  cacheVersion += 1;
  listeners.forEach((listener) => listener(key));
}

function emitInvalidate(prefix: string): void {
  cacheVersion += 1;
  listeners.forEach((listener) => listener(`invalidate:${prefix}`));
}

function subscribeCache(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------- context

export interface RequestOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit | null;
}

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  ratio: number;
}

export interface UploadParams {
  app: AppName;
  scope: string;
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

export interface StreamUploadParams {
  path: string;
  headers?: Record<string, string>;
  onProgress?: (event: UploadProgressEvent) => void;
  signal?: AbortSignal;
}

interface AgentContextValue {
  tenant: string;
  setTenant: (tenant: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  streamUpload: <T>(file: File, params: StreamUploadParams) => Promise<T>;
  uploadArtifact: (file: File, params: UploadParams) => Promise<UploadResponse>;
  cacheKey: (path: string) => string;
  invalidate: (pathPrefix: string) => void;
  primeCache: <T>(path: string, data: T) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenantState] = usePersistentState<string>("tenant", "demo");
  const [apiKey, setApiKey] = usePersistentState<string>("api-key", "");

  const setTenant = useCallback(
    (next: string) => setTenantState(next.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63) || "demo"),
    [setTenantState],
  );

  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "X-Tenant-ID": tenant };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }, [tenant, apiKey]);

  const request = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      const { json, headers, ...rest } = options;
      const response = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers: {
          Accept: "application/json",
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          ...authHeaders(),
          ...(headers as Record<string, string> | undefined),
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      if (response.status === 204) return undefined as T;
      const contentType = response.headers.get("content-type") ?? "";
      const payload: unknown = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
        throw new ApiError(response.status, messageFromDetail(detail, response.statusText), detail);
      }
      return payload as T;
    },
    [authHeaders],
  );

  const streamUpload = useCallback(
    <T,>(file: File, params: StreamUploadParams): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        // XHR is used (not fetch) because it exposes upload progress events.
        // The File is sent as the raw request body; the browser streams it from disk.
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}${params.path}`);
        const headers: Record<string, string> = {
          ...authHeaders(),
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
          ...params.headers,
        };
        Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
        xhr.upload.onprogress = (event) => {
          const total = event.lengthComputable ? event.total : file.size;
          params.onProgress?.({ loaded: event.loaded, total, ratio: total ? event.loaded / total : 0 });
        };
        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            body = xhr.responseText;
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
          else {
            const detail = (body as { detail?: unknown } | null)?.detail ?? body;
            reject(new ApiError(xhr.status, messageFromDetail(detail, `Upload failed (${xhr.status})`), detail));
          }
        };
        xhr.onerror = () => reject(new ApiError(0, "Network error during upload.", null));
        xhr.onabort = () => reject(new ApiError(0, "Upload cancelled.", null));
        params.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(file);
      }),
    [authHeaders],
  );

  const uploadArtifact = useCallback(
    (file: File, params: UploadParams) =>
      streamUpload<UploadResponse>(file, {
        path: `/api/v1/artifacts/upload?app=${params.app}&scope=${encodeURIComponent(params.scope)}`,
        onProgress: params.onProgress,
        signal: params.signal,
      }),
    [streamUpload],
  );

  const cacheKey = useCallback((path: string) => `${tenant}|${path}`, [tenant]);
  const invalidate = useCallback((prefix: string) => emitInvalidate(`${tenant}|${prefix}`), [tenant]);
  const primeCache = useCallback(
    <T,>(path: string, data: T) => cacheSet(`${tenant}|${path}`, data, true),
    [tenant],
  );

  const value = useMemo<AgentContextValue>(
    () => ({ tenant, setTenant, apiKey, setApiKey, request, streamUpload, uploadArtifact, cacheKey, invalidate, primeCache }),
    [tenant, setTenant, apiKey, setApiKey, request, streamUpload, uploadArtifact, cacheKey, invalidate, primeCache],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentAPI(): AgentContextValue {
  const context = useContext(AgentContext);
  if (!context) throw new Error("useAgentAPI must be used inside <AgentProvider>.");
  return context;
}

// ---------------------------------------------------------------- useResource (fetch state + cache + polling)

export type FetchStatus = "idle" | "loading" | "success" | "error";

export interface ResourceOptions {
  pollMs?: number;
  persist?: boolean;
  enabled?: boolean;
}

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  status: FetchStatus;
  isFetching: boolean;
  updatedAt: number | null;
  refresh: () => Promise<T | undefined>;
  mutate: (updater: T | ((prev: T | undefined) => T)) => void;
}

export function useResource<T>(path: string | null, options: ResourceOptions = {}): Resource<T> {
  const { request, cacheKey } = useAgentAPI();
  const { pollMs, persist = true, enabled = true } = options;
  const key = path ? cacheKey(path) : null;

  useSyncExternalStore(subscribeCache, () => cacheVersion);
  const entry = key ? cacheGet(key) : undefined;

  const [error, setError] = useState<ApiError | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const inflight = useRef<Promise<T | undefined> | null>(null);

  const refresh = useCallback(async (): Promise<T | undefined> => {
    if (!path || !key || !enabled) return undefined;
    if (inflight.current) return inflight.current;
    setIsFetching(true);
    const promise = request<T>(path)
      .then((data) => {
        cacheSet(key, data, persist);
        setError(null);
        return data;
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err : new ApiError(0, err instanceof Error ? err.message : String(err), null));
        return undefined;
      })
      .finally(() => {
        inflight.current = null;
        setIsFetching(false);
      });
    inflight.current = promise;
    return promise;
  }, [path, key, enabled, request, persist]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!key) return undefined;
    return subscribeCache((event) => {
      if (event.startsWith("invalidate:") && key.startsWith(event.slice("invalidate:".length))) void refresh();
    });
  }, [key, refresh]);

  useEffect(() => {
    if (!pollMs || !enabled || !path) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, enabled, path, refresh]);

  const mutate = useCallback(
    (updater: T | ((prev: T | undefined) => T)) => {
      if (!key) return;
      const previous = cacheGet(key)?.data as T | undefined;
      const next = typeof updater === "function" ? (updater as (p: T | undefined) => T)(previous) : updater;
      cacheSet(key, next, persist);
    },
    [key, persist],
  );

  const data = entry?.data as T | undefined;
  const status: FetchStatus = !path ? "idle" : data !== undefined ? "success" : error ? "error" : "loading";
  return { data, error, status, isFetching, updatedAt: entry?.updatedAt ?? null, refresh, mutate };
}

// ---------------------------------------------------------------- useMutation

export interface Mutation<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  status: FetchStatus;
  error: ApiError | null;
  data: TResult | undefined;
  reset: () => void;
}

export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): Mutation<TArgs, TResult> {
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<TResult | undefined>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: TArgs) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await fnRef.current(...args);
      setData(result);
      setStatus("success");
      return result;
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, err instanceof Error ? err.message : String(err), null));
      setStatus("error");
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setData(undefined);
  }, []);

  return { run, status, error, data, reset };
}

// ---------------------------------------------------------------- polling ticker

const TERMINAL: Job["status"][] = ["succeeded", "failed"];

export function isTerminal(job: Job | null | undefined): boolean {
  return !!job && TERMINAL.includes(job.status);
}

/** Polls a background job with gentle backoff (600ms -> 2.5s) until it succeeds or fails. */
export function useJobPoller(
  jobId: string | null | undefined,
  { onSettled }: { onSettled?: (job: Job) => void } = {},
): { job: Job | null; active: boolean } {
  const { request } = useAgentAPI();
  const [job, setJob] = useState<Job | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return undefined;
    }
    let cancelled = false;
    let delay = 600;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const next = await request<Job>(`/api/v1/jobs/${jobId}`);
        if (cancelled) return;
        setJob(next);
        if (isTerminal(next)) {
          settledRef.current?.(next);
          return;
        }
      } catch {
        // Transient error: keep polling with backoff.
      }
      delay = Math.min(2500, Math.round(delay * 1.35));
      timer = window.setTimeout(tick, delay);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, request]);

  return { job, active: !!jobId && !isTerminal(job) };
}

// ---------------------------------------------------------------- upload queue

export type UploadPhase = "uploading" | "queued" | "processing" | "indexed" | "failed";

export interface UploadItem {
  id: string;
  filename: string;
  size: number;
  loaded: number;
  phase: UploadPhase;
  indexProgress: number;
  message: string;
  error: string | null;
  artifactId: string | null;
  jobId: string | null;
  startedAt: number;
}

/**
 * Manages a queue of file uploads for one app scope:
 * streams each file with byte-level progress, then follows its indexing job with a single
 * shared polling ticker until every item is indexed or failed.
 */
export function useUploadQueue({
  app,
  scope,
  concurrency = 2,
  onIndexed,
}: {
  app: AppName;
  scope: string | null;
  concurrency?: number;
  onIndexed?: (item: UploadItem) => void;
}) {
  const { uploadArtifact, request } = useAgentAPI();
  const [items, setItems] = useState<UploadItem[]>([]);
  const pending = useRef<{ id: string; file: File }[]>([]);
  const running = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());
  const onIndexedRef = useRef(onIndexed);
  onIndexedRef.current = onIndexed;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const pump = useCallback(() => {
    if (!scope) return;
    while (running.current < concurrency && pending.current.length > 0) {
      const next = pending.current.shift();
      if (!next) break;
      running.current += 1;
      const controller = new AbortController();
      controllers.current.set(next.id, controller);
      uploadArtifact(next.file, {
        app,
        scope,
        signal: controller.signal,
        onProgress: (event) => patch(next.id, { loaded: event.loaded, message: `${Math.round(event.ratio * 100)}% uploaded` }),
      })
        .then((response) =>
          patch(next.id, {
            loaded: next.file.size,
            phase: "queued",
            artifactId: response.artifact.id,
            jobId: response.job.id,
            message: "Queued for indexing",
          }),
        )
        .catch((err: unknown) =>
          patch(next.id, { phase: "failed", error: err instanceof Error ? err.message : String(err), message: "Upload failed" }),
        )
        .finally(() => {
          running.current -= 1;
          controllers.current.delete(next.id);
          pump();
        });
    }
  }, [app, scope, concurrency, uploadArtifact, patch]);

  const enqueue = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const created: UploadItem[] = list.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        size: file.size,
        loaded: 0,
        phase: "uploading",
        indexProgress: 0,
        message: "Starting upload",
        error: null,
        artifactId: null,
        jobId: null,
        startedAt: Date.now(),
      }));
      setItems((prev) => [...created, ...prev]);
      created.forEach((item, index) => pending.current.push({ id: item.id, file: list[index] }));
      pump();
    },
    [pump],
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    pending.current = pending.current.filter((p) => p.id !== id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((item) => item.phase !== "indexed" && item.phase !== "failed"));
  }, []);

  // Shared polling ticker: one interval services every item waiting on an indexing job.
  const hasActiveJobs = items.some((item) => item.jobId && (item.phase === "queued" || item.phase === "processing"));
  useEffect(() => {
    if (!hasActiveJobs) return undefined;
    let cancelled = false;
    const tick = async () => {
      const active = itemsRef.current.filter((i) => i.jobId && (i.phase === "queued" || i.phase === "processing"));
      await Promise.all(
        active.map(async (item) => {
          try {
            const job = await request<Job>(`/api/v1/jobs/${item.jobId}`);
            if (cancelled) return;
            if (job.status === "succeeded") {
              const done: UploadItem = { ...item, phase: "indexed", indexProgress: 1, message: job.message || "Indexed" };
              patch(item.id, done);
              onIndexedRef.current?.(done);
            } else if (job.status === "failed") {
              patch(item.id, { phase: "failed", error: job.error ?? "Indexing failed", message: "Indexing failed" });
            } else {
              patch(item.id, {
                phase: job.status === "running" ? "processing" : "queued",
                indexProgress: job.progress,
                message: job.message,
              });
            }
          } catch {
            // Ignore transient polling errors; the next tick retries.
          }
        }),
      );
    };
    void tick();
    const timer = window.setInterval(tick, 900);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveJobs, request, patch]);

  // Reset the visible queue when switching scope (e.g. another course).
  useEffect(() => {
    setItems([]);
    pending.current = [];
  }, [scope]);

  return { items, enqueue, cancel, clearFinished };
}

// ---------------------------------------------------------------- misc helpers

export function useDebouncedCallback<TArgs extends unknown[]>(fn: (...args: TArgs) => void, delayMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(
    (...args: TArgs) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => fnRef.current(...args), delayMs);
    },
    [delayMs],
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const then = typeof iso === "number" ? iso : new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
