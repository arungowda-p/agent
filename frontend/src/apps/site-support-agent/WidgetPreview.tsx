import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Citation, SupportChatResponse, Ticket } from "../../shared/api/types";
import { useAgentAPI } from "../../shared/hooks/useAgentAPI";
import { IconChat, IconCheck, IconFile, IconMonitor, IconPhone, IconRefresh, IconSend, IconUser, IconX } from "../../shared/ui/icons";
import { cx, IconButton, Spinner } from "../../shared/ui/primitives";

interface Appearance {
  name: string;
  brandName: string;
  color: string;
  position: "left" | "right";
  greeting: string;
  placeholder: string;
  showPoweredBy: boolean;
}

interface Turn extends ChatMessage {
  id: string;
  citations?: Citation[];
  followups?: string[];
  escalate?: boolean;
  confidence?: "high" | "low";
}

function readableText(hex: string): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#6366f1";
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#09090b" : "#ffffff";
}

function CitationBubbles({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap gap-1">
        {citations.map((citation, index) => (
          <button
            key={`${citation.chunk_id}-${index}`}
            type="button"
            onClick={() => setOpen((v) => (v === index ? null : index))}
            aria-expanded={open === index}
            className={cx(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
              open === index ? "border-zinc-400 bg-zinc-100 text-zinc-900" : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400",
            )}
          >
            <span className="font-mono text-[9.5px] text-zinc-400">{index + 1}</span>
            <IconFile size={10} />
            <span className="truncate">{citation.source}</span>
          </button>
        ))}
      </div>
      {open !== null && citations[open] ? (
        <blockquote className="animate-fade-in rounded-md border-l-2 border-zinc-300 bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-zinc-600">
          “{citations[open].quote}”
          <span className="mt-0.5 block text-[10px] text-zinc-400">{citations[open].location}</span>
        </blockquote>
      ) : null}
    </div>
  );
}

function EscalationForm({
  color,
  onSubmit,
  onCancel,
}: {
  color: string;
  onSubmit: (email: string, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="animate-fade-in space-y-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        onSubmit(email, note)
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-[12px] font-medium text-zinc-800">Talk to a person</p>
      <input
        type="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Your email"
        className="h-8 w-full rounded-md border border-zinc-300 px-2 text-[12px] text-zinc-900 focus:border-zinc-500 focus:outline-none"
      />
      <textarea
        rows={2}
        placeholder="Anything we should know? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Note"
        className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-[12px] text-zinc-900 focus:border-zinc-500 focus:outline-none"
      />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="h-7 rounded-md px-2.5 text-[12px] text-zinc-500 hover:text-zinc-800">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md px-3 text-[12px] font-medium disabled:opacity-50"
          style={{ backgroundColor: color, color: readableText(color) }}
        >
          {busy ? <Spinner size={11} /> : null}
          Create ticket
        </button>
      </div>
    </form>
  );
}

export function WidgetPreview({ publicKey, appearance, dirty }: { publicKey: string; appearance: Appearance; dirty: boolean }) {
  const { request } = useAgentAPI();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [open, setOpen] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useMemo(() => `prev-${Math.random().toString(36).slice(2, 10)}`, [publicKey]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const color = /^#[0-9a-fA-F]{6}$/.test(appearance.color) ? appearance.color : "#6366f1";
  const onColor = readableText(color);

  useEffect(() => {
    setTurns([]);
    setTicket(null);
    setEscalating(false);
  }, [publicKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending, escalating, ticket]);

  const history = (list: Turn[]): ChatMessage[] => list.map(({ role, content }) => ({ role, content })).slice(-12);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    const next: Turn[] = [...turns, { id: crypto.randomUUID(), role: "user", content }];
    setTurns(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const reply = await request<SupportChatResponse>(`/api/v1/support/public/${publicKey}/chat`, {
        method: "POST",
        json: { session_id: sessionId, messages: history(next) },
      });
      setTurns((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply.answer,
          citations: reply.citations,
          followups: reply.suggested_followups,
          escalate: reply.needs_escalation,
          confidence: reply.confidence,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const escalate = async (email: string, note: string) => {
    const created = await request<Ticket>(`/api/v1/support/public/${publicKey}/escalate`, {
      method: "POST",
      json: { session_id: sessionId, email, note, messages: history(turns).length ? history(turns) : [{ role: "user", content: note || "Requested a human." }] },
    });
    setTicket(created);
    setEscalating(false);
  };

  const frameWidth = device === "desktop" ? "w-full" : "w-[300px]";

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Live preview</h2>
          {dirty ? <span className="text-[10.5px] text-amber-300">Unsaved styling shown</span> : null}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Desktop viewport" onClick={() => setDevice("desktop")} className={device === "desktop" ? "bg-zinc-900 text-ink" : ""}>
            <IconMonitor size={13} />
          </IconButton>
          <IconButton label="Mobile viewport" onClick={() => setDevice("mobile")} className={device === "mobile" ? "bg-zinc-900 text-ink" : ""}>
            <IconPhone size={13} />
          </IconButton>
          <IconButton
            label="Reset conversation"
            onClick={() => {
              setTurns([]);
              setTicket(null);
              setEscalating(false);
              setError(null);
            }}
          >
            <IconRefresh size={13} />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden bg-[radial-gradient(#18181b_1px,transparent_1px)] p-4 [background-size:14px_14px]">
        <div
          className={cx(
            "relative flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line-strong bg-zinc-100 shadow-2xl shadow-black/60 transition-[width] duration-300",
            frameWidth,
          )}
        >
          {/* Simulated host website */}
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-2.5">
            <span className="h-2 w-2 rounded-full bg-zinc-300" />
            <span className="h-2 w-2 rounded-full bg-zinc-300" />
            <span className="h-2 w-2 rounded-full bg-zinc-300" />
            <span className="ml-2 h-3.5 flex-1 rounded bg-zinc-100 text-center font-mono text-[9px] leading-[14px] text-zinc-400">
              yourcustomer.com
            </span>
          </div>
          <div className="pointer-events-none space-y-2 p-4" aria-hidden="true">
            <div className="h-3 w-1/3 rounded bg-zinc-300" />
            <div className="h-2 w-5/6 rounded bg-zinc-200" />
            <div className="h-2 w-4/6 rounded bg-zinc-200" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="h-12 rounded bg-zinc-200" />
              <div className="h-12 rounded bg-zinc-200" />
              <div className="h-12 rounded bg-zinc-200" />
            </div>
          </div>

          {open ? (
            <div
              className={cx(
                "absolute bottom-16 flex animate-fade-in flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/20",
                device === "mobile" ? "inset-x-2 top-9" : "top-10 w-[300px]",
                device === "desktop" && (appearance.position === "left" ? "left-3" : "right-3"),
              )}
              role="dialog"
              aria-label={`${appearance.brandName} chat`}
            >
              <div className="flex shrink-0 items-center gap-2 px-3 py-2.5" style={{ backgroundColor: color, color: onColor }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10">
                  <IconChat size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold">{appearance.brandName}</p>
                  <p className="text-[10px] opacity-75">Answers from our help content</p>
                </div>
                <button type="button" aria-label="Minimise chat" onClick={() => setOpen(false)} className="opacity-75 hover:opacity-100">
                  <IconX size={13} />
                </button>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-zinc-50 px-3 py-3">
                <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] leading-snug text-zinc-800">
                  {appearance.greeting}
                </div>
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <div key={turn.id} className="flex justify-end">
                      <div
                        className="max-w-[85%] rounded-xl rounded-tr-sm px-2.5 py-1.5 text-[12px] leading-snug"
                        style={{ backgroundColor: color, color: onColor }}
                      >
                        {turn.content}
                      </div>
                    </div>
                  ) : (
                    <div key={turn.id} className="max-w-[92%]">
                      <div className="rounded-xl rounded-tl-sm border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap text-zinc-800">
                        {turn.content}
                      </div>
                      {turn.citations && turn.citations.length > 0 ? <CitationBubbles citations={turn.citations} /> : null}
                      {turn.escalate && !ticket ? (
                        <button
                          type="button"
                          onClick={() => setEscalating(true)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:border-zinc-500"
                        >
                          <IconUser size={11} />
                          Talk to a human
                        </button>
                      ) : null}
                      {turn.followups && turn.followups.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {turn.followups.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => void send(f)}
                              className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10.5px] text-zinc-600 hover:border-zinc-500"
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ),
                )}
                {sending ? (
                  <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2" aria-label="Agent is typing">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                  </div>
                ) : null}
                {escalating ? (
                  <EscalationForm color={color} onSubmit={escalate} onCancel={() => setEscalating(false)} />
                ) : null}
                {ticket ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11.5px] text-emerald-800">
                    <IconCheck size={13} className="mt-px shrink-0" />
                    <span>
                      Ticket <span className="font-mono">{ticket.id.slice(-6)}</span> created. A teammate will email {ticket.email}.
                    </span>
                  </div>
                ) : null}
                {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
              </div>

              <form
                className="flex shrink-0 items-center gap-1.5 border-t border-zinc-200 bg-white p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={appearance.placeholder}
                  aria-label="Message"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-[12px] text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!input.trim() || sending}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
                  style={{ backgroundColor: color, color: onColor }}
                >
                  <IconSend size={13} />
                </button>
              </form>
              {appearance.showPoweredBy ? (
                <p className="shrink-0 bg-white pb-1.5 text-center text-[9.5px] text-zinc-400">Powered by Agent Suite</p>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close chat" : "Open chat"}
            className={cx(
              "absolute bottom-3 flex h-11 w-11 items-center justify-center rounded-full shadow-lg shadow-zinc-900/30 transition-transform hover:scale-105",
              appearance.position === "left" ? "left-3" : "right-3",
            )}
            style={{ backgroundColor: color, color: onColor }}
          >
            {open ? <IconX size={16} /> : <IconChat size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
