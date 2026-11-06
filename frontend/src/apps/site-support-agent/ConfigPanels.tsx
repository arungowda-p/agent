import { useState, type ReactNode } from "react";
import type { Artifact, IngestResponse, Ticket, Tone, Widget, WidgetPatch } from "../../shared/api/types";
import { timeAgo, useAgentAPI, useJobPoller, useMutation, useResource, useUploadQueue } from "../../shared/hooks/useAgentAPI";
import { IconCheck, IconLink, IconSlack, IconTrash, IconUser } from "../../shared/ui/icons";
import {
  Badge,
  Button,
  cx,
  Dropzone,
  Field,
  IconButton,
  InlineError,
  Input,
  Progress,
  Select,
  Textarea,
  Toggle,
} from "../../shared/ui/primitives";
import { ArtifactList, UploadQueueList } from "../../shared/ui/UploadQueue";

export type Draft = WidgetPatch & { whitelabel: Widget["whitelabel"] };

interface PanelProps {
  widget: Widget;
  draft: Draft;
  setDraft: (updater: (prev: Draft) => Draft) => void;
}

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-[6px] border border-line">
      <header className="border-b border-line px-4 py-2.5">
        <h3 className="text-[12.5px] font-medium text-ink">{title}</h3>
        {description ? <p className="mt-0.5 text-[11px] text-ink-4">{description}</p> : null}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- Sources

export function SourcesPanel({ widget, onWidget }: { widget: Widget; onWidget: (widget: Widget) => void }) {
  const { request, invalidate } = useAgentAPI();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(5);
  const [jobId, setJobId] = useState<string | null>(null);
  const artifactsPath = `/api/v1/artifacts?app=support&scope=${widget.id}`;
  const artifacts = useResource<Artifact[]>(artifactsPath);
  const widgetPath = `/api/v1/support/widgets/${widget.id}`;

  const { job, active } = useJobPoller(jobId, {
    onSettled: () => {
      invalidate(artifactsPath);
      void request<Widget>(widgetPath).then(onWidget);
    },
  });

  const crawl = useMutation(async () => {
    const response = await request<IngestResponse>(`${widgetPath}/sources/url`, {
      method: "POST",
      json: { url: url.trim(), max_pages: maxPages },
    });
    onWidget(response.widget);
    setJobId(response.job.id);
    setUrl("");
    return response;
  });

  const removeSource = useMutation(async (sourceId: string) => {
    const updated = await request<Widget>(`${widgetPath}/sources/${sourceId}`, { method: "DELETE" });
    onWidget(updated);
    invalidate(artifactsPath);
    return updated;
  });

  const queue = useUploadQueue({ app: "support", scope: widget.id, onIndexed: () => invalidate(artifactsPath) });

  const fileArtifacts = (artifacts.data ?? []).filter((a) => !a.source_url);

  return (
    <div className="space-y-4">
      <Card title="Website crawl" description="Fetches same-domain pages, strips navigation, and indexes the content.">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim()) void crawl.run();
          }}
        >
          <Input
            type="url"
            required
            placeholder="https://docs.example.com/help"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="URL to crawl"
          />
          <Select
            ariaLabel="Max pages"
            value={String(maxPages)}
            onChange={(v) => setMaxPages(Number(v))}
            options={["1", "5", "10", "25"].map((v) => ({ value: v, label: `${v} page${v === "1" ? "" : "s"}` }))}
            className="sm:w-28"
          />
          <Button type="submit" variant="primary" size="md" loading={crawl.status === "loading" || active} icon={<IconLink size={13} />}>
            Crawl
          </Button>
        </form>
        <InlineError message={crawl.error?.message} />
        {job && active ? (
          <div className="space-y-1">
            <Progress value={job.progress} tone="accent" label="Crawl progress" />
            <p className="truncate text-[11px] text-ink-4">{job.message}</p>
          </div>
        ) : null}
        {job?.status === "failed" ? <InlineError message={job.error} /> : null}

        <ul className="divide-y divide-line rounded-[5px] border border-line">
          {widget.sources.length === 0 ? (
            <li className="px-3 py-3 text-center text-[11px] text-ink-4">No URLs ingested yet.</li>
          ) : null}
          {widget.sources.map((source) => (
            <li key={source.id} className="group flex items-center gap-3 px-3 py-2">
              <IconLink size={13} className="shrink-0 text-ink-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11.5px] text-ink-2">{source.url}</p>
                <p className="text-[10.5px] text-ink-4 tabular">
                  {source.pages.length} pages · max {source.max_pages} · crawled {timeAgo(source.last_crawled_at)}
                </p>
                {source.error ? <p className="truncate text-[10.5px] text-red-400">{source.error}</p> : null}
              </div>
              <Badge
                tone={source.status === "indexed" ? "ok" : source.status === "failed" ? "bad" : "accent"}
              >
                {source.status}
              </Badge>
              <IconButton
                label={`Remove ${source.url}`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                onClick={() => void removeSource.run(source.id)}
              >
                <IconTrash size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Documents" description="FAQs, price sheets, manuals. Indexed alongside crawled pages.">
        <Dropzone accept=".pdf,.docx,.md,.txt,.html,.csv,.xlsx" onFiles={queue.enqueue} label="Drop help documents" compact />
        <div className="overflow-hidden rounded-[5px] border border-line">
          <UploadQueueList items={queue.items} onCancel={queue.cancel} />
          <ArtifactList
            artifacts={fileArtifacts}
            emptyLabel="No documents uploaded."
            onDelete={(artifact) =>
              void request(`/api/v1/artifacts/${artifact.id}`, { method: "DELETE" }).then(() => invalidate(artifactsPath))
            }
          />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Routing

export function RoutingPanel({ widget, draft, setDraft }: PanelProps) {
  const { request } = useAgentAPI();
  const tickets = useResource<Ticket[]>(`/api/v1/support/widgets/${widget.id}/tickets`, { pollMs: 15000 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const test = useMutation(() =>
    request<{ delivered: boolean }>(`/api/v1/support/widgets/${widget.id}/slack/test`, { method: "POST" }),
  );

  return (
    <div className="space-y-4">
      <Card title="Slack routing" description="Escalations post to a Slack channel through an incoming webhook.">
        <Field
          label="Incoming webhook URL"
          htmlFor="slack-url"
          hint={widget.slack_configured ? `Configured: ${widget.slack_webhook_url}` : "https://hooks.slack.com/services/…"}
        >
          <Input
            id="slack-url"
            type="url"
            placeholder={widget.slack_configured ? "Leave blank to keep current webhook" : "https://hooks.slack.com/services/T000/B000/XXXX"}
            value={draft.slack_webhook_url ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, slack_webhook_url: e.target.value }))}
            className="font-mono text-[12px]"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Channel label" htmlFor="slack-channel" hint="Shown to your team only">
            <Input
              id="slack-channel"
              placeholder="#support-escalations"
              value={draft.slack_channel_label ?? widget.slack_channel_label}
              onChange={(e) => setDraft((d) => ({ ...d, slack_channel_label: e.target.value }))}
            />
          </Field>
          <Field label="Fallback email" htmlFor="esc-email">
            <Input
              id="esc-email"
              type="email"
              placeholder="support@company.com"
              value={draft.escalation_email ?? widget.escalation_email}
              onChange={(e) => setDraft((d) => ({ ...d, escalation_email: e.target.value }))}
            />
          </Field>
        </div>
        <Toggle
          label="Offer escalation on low confidence"
          description="Shows the 'Talk to a human' action whenever the agent cannot ground its answer."
          checked={draft.escalate_on_low_confidence ?? widget.escalate_on_low_confidence}
          onChange={(value) => setDraft((d) => ({ ...d, escalate_on_low_confidence: value }))}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={<IconSlack size={13} />}
            disabled={!widget.slack_configured}
            loading={test.status === "loading"}
            onClick={() => void test.run()}
          >
            Send test message
          </Button>
          {test.data ? (
            <Badge tone={test.data.delivered ? "ok" : "bad"}>{test.data.delivered ? "Delivered" : "Not delivered"}</Badge>
          ) : null}
          <InlineError message={test.error?.message} />
        </div>
      </Card>

      <Card title="Escalated tickets" description="Conversations visitors handed off to a human.">
        <ul className="divide-y divide-line rounded-[5px] border border-line">
          {(tickets.data ?? []).length === 0 ? (
            <li className="px-3 py-3 text-center text-[11px] text-ink-4">No tickets yet.</li>
          ) : null}
          {(tickets.data ?? []).map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => setExpanded((id) => (id === ticket.id ? null : ticket.id))}
                aria-expanded={expanded === ticket.id}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-900/40"
              >
                <IconUser size={13} className="text-ink-4" />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{ticket.email}</span>
                <span className="text-[10.5px] text-ink-4">{timeAgo(ticket.created_at)}</span>
                <Badge tone={ticket.slack_delivered ? "ok" : "neutral"}>{ticket.slack_delivered ? "Slack" : "Stored"}</Badge>
              </button>
              {expanded === ticket.id ? (
                <div className="space-y-1.5 border-t border-line bg-canvas px-3 py-2">
                  {ticket.note ? <p className="text-[11.5px] text-ink-3">Note: {ticket.note}</p> : null}
                  {ticket.transcript.map((m, i) => (
                    <p key={i} className="text-[11.5px]">
                      <span className={m.role === "user" ? "text-ink" : "text-ink-4"}>{m.role === "user" ? "Visitor" : "Agent"}:</span>{" "}
                      <span className="text-ink-3">{m.content}</span>
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Appearance

export const ACCENTS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#e4e4e7", "#18181b"];

export function AppearancePanel({ widget, draft, setDraft }: PanelProps) {
  const color = draft.primary_color ?? widget.primary_color;
  const validHex = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <div className="space-y-4">
      <Card title="Brand accent" description="Used for the launcher, header and visitor message bubbles.">
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={color.toLowerCase() === swatch}
              aria-label={swatch}
              onClick={() => setDraft((d) => ({ ...d, primary_color: swatch }))}
              className={cx(
                "h-7 w-7 rounded-[5px] border transition-transform hover:scale-105",
                color.toLowerCase() === swatch ? "border-white ring-1 ring-white/40" : "border-line-strong",
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
          <label className="ml-1 flex items-center gap-2">
            <input
              type="color"
              value={validHex ? color : "#6366f1"}
              onChange={(e) => setDraft((d) => ({ ...d, primary_color: e.target.value }))}
              className="h-7 w-7 cursor-pointer rounded-[5px] border border-line-strong bg-transparent p-0.5"
              aria-label="Custom accent color"
            />
            <Input
              value={color}
              onChange={(e) => setDraft((d) => ({ ...d, primary_color: e.target.value }))}
              className={cx("h-7 w-24 font-mono text-xs", !validHex && "border-red-500/60")}
              aria-label="Accent hex value"
              maxLength={7}
            />
          </label>
        </div>
      </Card>
      <Card title="Behaviour & copy">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Widget name" htmlFor="w-name">
            <Input id="w-name" value={draft.name ?? widget.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Field>
          <Field label="Launcher position" htmlFor="w-pos">
            <Select
              id="w-pos"
              value={draft.position ?? widget.position}
              onChange={(v) => setDraft((d) => ({ ...d, position: v }))}
              options={[
                { value: "right", label: "Bottom right" },
                { value: "left", label: "Bottom left" },
              ]}
            />
          </Field>
          <Field label="Tone" htmlFor="w-tone">
            <Select<Tone>
              id="w-tone"
              value={draft.tone ?? widget.tone}
              onChange={(v) => setDraft((d) => ({ ...d, tone: v }))}
              options={[
                { value: "friendly", label: "Friendly" },
                { value: "concise", label: "Concise" },
                { value: "formal", label: "Formal" },
              ]}
            />
          </Field>
          <Field label="Input placeholder" htmlFor="w-ph">
            <Input
              id="w-ph"
              value={draft.placeholder ?? widget.placeholder}
              onChange={(e) => setDraft((d) => ({ ...d, placeholder: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Greeting" htmlFor="w-greet">
          <Textarea
            id="w-greet"
            rows={2}
            value={draft.greeting ?? widget.greeting}
            onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
          />
        </Field>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Whitelabel

export function WhitelabelPanel({ widget, draft, setDraft }: PanelProps) {
  const wl = draft.whitelabel;
  const setWl = (changes: Partial<Widget["whitelabel"]>) => setDraft((d) => ({ ...d, whitelabel: { ...d.whitelabel, ...changes } }));
  const [copied, setCopied] = useState(false);
  const endpoint = `${window.location.origin}/api/v1/support/public/${widget.public_key}/chat`;
  const origins = draft.allowed_origins ?? widget.allowed_origins;

  return (
    <div className="space-y-4">
      <Card title="Agency whitelabel mode" description="Resell the widget under your own brand to end clients.">
        <Toggle
          label="Enable whitelabel"
          description="Replaces product branding with your agency brand across the widget."
          checked={wl.enabled}
          onChange={(enabled) => setWl({ enabled })}
        />
        <div className={cx("grid gap-4 transition-opacity sm:grid-cols-2", !wl.enabled && "pointer-events-none opacity-40")}>
          <Field label="Brand name" htmlFor="wl-brand">
            <Input id="wl-brand" placeholder="Acme Digital" value={wl.brand_name} onChange={(e) => setWl({ brand_name: e.target.value })} />
          </Field>
          <Field label="End-client label" htmlFor="wl-client" hint="Internal: which client this widget serves">
            <Input id="wl-client" placeholder="Bright Dental Co." value={wl.client_label} onChange={(e) => setWl({ client_label: e.target.value })} />
          </Field>
          <Field label="Custom domain" htmlFor="wl-domain" hint="CNAME this host to your deployment">
            <Input
              id="wl-domain"
              placeholder="help.acmedigital.com"
              value={wl.custom_domain}
              onChange={(e) => setWl({ custom_domain: e.target.value })}
              className="font-mono text-[12px]"
            />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle label="Hide “Powered by”" checked={wl.hide_powered_by} onChange={(hide_powered_by) => setWl({ hide_powered_by })} />
          </div>
        </div>
      </Card>

      <Card title="Embedding & security">
        <Field label="Allowed origins" htmlFor="wl-origins" hint="One per line. Empty allows any origin.">
          <Textarea
            id="wl-origins"
            rows={3}
            className="font-mono text-[12px]"
            placeholder="https://www.example.com"
            value={origins.join("\n")}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                allowed_origins: e.target.value
                  .split(/\r?\n/)
                  .map((o) => o.trim())
                  .filter(Boolean),
              }))
            }
          />
        </Field>
        <Field label="Public chat endpoint" htmlFor="wl-endpoint" hint="POST {session_id, messages[]} — no API key needed; rate limited per visitor.">
          <div className="flex gap-2">
            <Input id="wl-endpoint" readOnly value={endpoint} className="font-mono text-[11.5px] text-ink-3" />
            <Button
              size="md"
              icon={copied ? <IconCheck size={13} /> : undefined}
              onClick={() => {
                void navigator.clipboard.writeText(endpoint).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Field>
      </Card>
    </div>
  );
}
