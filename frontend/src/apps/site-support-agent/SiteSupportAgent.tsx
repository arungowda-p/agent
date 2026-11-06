import { useCallback, useEffect, useMemo, useState } from "react";
import type { Widget } from "../../shared/api/types";
import { useAgentAPI, useMutation, usePersistentState, useResource } from "../../shared/hooks/useAgentAPI";
import { IconChat, IconLink, IconPalette, IconPlus, IconSlack, IconTag, IconTrash } from "../../shared/ui/icons";
import { Badge, Button, cx, EmptyState, Flash, InlineError, Input, Select, Spinner, Tabs, useFlash } from "../../shared/ui/primitives";
import { AppearancePanel, RoutingPanel, SourcesPanel, WhitelabelPanel, type Draft } from "./ConfigPanels";
import { WidgetPreview } from "./WidgetPreview";

type TabId = "sources" | "routing" | "appearance" | "whitelabel";

const WIDGETS_PATH = "/api/v1/support/widgets";

function emptyDraft(widget: Widget): Draft {
  return { whitelabel: { ...widget.whitelabel } };
}

function isDirty(widget: Widget, draft: Draft): boolean {
  const { whitelabel, ...rest } = draft;
  const changed = Object.entries(rest).some(([key, value]) => {
    if (key === "slack_webhook_url") return typeof value === "string" && value.trim().length > 0;
    return JSON.stringify(value) !== JSON.stringify(widget[key as keyof Widget]);
  });
  return changed || JSON.stringify(whitelabel) !== JSON.stringify(widget.whitelabel);
}

export default function SiteSupportAgent() {
  const { request, invalidate } = useAgentAPI();
  const widgets = useResource<Widget[]>(WIDGETS_PATH);
  const [selectedId, setSelectedId] = usePersistentState<string | null>("ssa:selected", null);
  const [tab, setTab] = usePersistentState<TabId>("ssa:tab", "sources");
  const [newName, setNewName] = useState("");
  const [flashMessage, flash] = useFlash();

  const list = widgets.data ?? [];
  const widget = list.find((w) => w.id === selectedId) ?? list[0] ?? null;
  const [draft, setDraftState] = useState<Draft | null>(widget ? emptyDraft(widget) : null);

  useEffect(() => {
    setDraftState(widget ? emptyDraft(widget) : null);
    // Only reset when switching widgets, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget?.id]);

  const setDraft = useCallback((updater: (prev: Draft) => Draft) => {
    setDraftState((prev) => (prev ? updater(prev) : prev));
  }, []);

  const replaceWidget = useCallback(
    (updated: Widget) => widgets.mutate((prev) => (prev ?? []).map((w) => (w.id === updated.id ? updated : w))),
    [widgets],
  );

  const create = useMutation(async () => {
    const created = await request<Widget>(WIDGETS_PATH, { method: "POST", json: { name: newName.trim() || "Support widget" } });
    widgets.mutate((prev) => [created, ...(prev ?? [])]);
    setSelectedId(created.id);
    setNewName("");
    return created;
  });

  const save = useMutation(async () => {
    if (!widget || !draft) return undefined;
    const payload: Record<string, unknown> = { ...draft };
    if (typeof payload.slack_webhook_url === "string" && !payload.slack_webhook_url.trim()) delete payload.slack_webhook_url;
    const updated = await request<Widget>(`${WIDGETS_PATH}/${widget.id}`, { method: "PATCH", json: payload });
    replaceWidget(updated);
    setDraftState(emptyDraft(updated));
    flash("Widget saved");
    return updated;
  });

  const remove = useMutation(async () => {
    if (!widget) return undefined;
    await request(`${WIDGETS_PATH}/${widget.id}`, { method: "DELETE" });
    widgets.mutate((prev) => (prev ?? []).filter((w) => w.id !== widget.id));
    setSelectedId(null);
    invalidate(WIDGETS_PATH);
    return true;
  });

  const dirty = widget && draft ? isDirty(widget, draft) : false;

  const appearance = useMemo(() => {
    if (!widget || !draft) return null;
    const wl = draft.whitelabel;
    const name = draft.name ?? widget.name;
    return {
      name,
      brandName: wl.enabled && wl.brand_name ? wl.brand_name : name,
      color: draft.primary_color ?? widget.primary_color,
      position: draft.position ?? widget.position,
      greeting: draft.greeting ?? widget.greeting,
      placeholder: draft.placeholder ?? widget.placeholder,
      showPoweredBy: !(wl.enabled && wl.hide_powered_by),
    };
  }, [widget, draft]);

  if (widgets.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-ink-4">
        <Spinner />
      </div>
    );
  }

  if (!widget || !draft || !appearance) {
    return (
      <EmptyState
        icon={<IconChat size={22} />}
        title="Create your first support widget"
        body="Point it at a help site or upload FAQs. It answers visitors with citations and hands off to Slack when unsure."
        action={
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create.run();
            }}
          >
            <Input placeholder="Widget name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-48" />
            <Button type="submit" variant="primary" size="md" loading={create.status === "loading"} icon={<IconPlus size={13} />}>
              Create
            </Button>
          </form>
        }
      />
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex min-h-0 flex-col border-line lg:border-r" aria-label="Widget configuration">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Select
            ariaLabel="Select widget"
            value={widget.id}
            onChange={(id) => setSelectedId(id)}
            options={list.map((w) => ({
              value: w.id,
              label: w.whitelabel.enabled && w.whitelabel.client_label ? `${w.name} — ${w.whitelabel.client_label}` : w.name,
            }))}
            className="w-56"
          />
          {widget.whitelabel.enabled ? <Badge tone="accent">Whitelabel</Badge> : null}
          <Badge tone={widget.sources.some((s) => s.status === "indexed") ? "ok" : "neutral"}>
            {widget.sources.reduce((n, s) => n + s.pages.length, 0)} pages
          </Badge>
          <form
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void create.run();
            }}
          >
            <Input placeholder="New widget" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 w-32 text-xs" aria-label="New widget name" />
            <Button type="submit" size="sm" icon={<IconPlus size={12} />} loading={create.status === "loading"}>
              Add
            </Button>
          </form>
          <Button size="sm" variant="danger" icon={<IconTrash size={12} />} loading={remove.status === "loading"} onClick={() => {
            if (window.confirm(`Delete widget “${widget.name}” and its indexed content?`)) void remove.run();
          }}>
            Delete
          </Button>
        </div>

        <Tabs<TabId>
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "sources", label: "Sources", icon: <IconLink size={12} />, badge: <span className="text-ink-4 tabular">{widget.sources.length}</span> },
            { id: "routing", label: "Slack routing", icon: <IconSlack size={12} /> },
            { id: "appearance", label: "Appearance", icon: <IconPalette size={12} /> },
            { id: "whitelabel", label: "Agency whitelabel", icon: <IconTag size={12} /> },
          ]}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
          {tab === "sources" ? <SourcesPanel widget={widget} onWidget={replaceWidget} /> : null}
          {tab === "routing" ? <RoutingPanel widget={widget} draft={draft} setDraft={setDraft} /> : null}
          {tab === "appearance" ? <AppearancePanel widget={widget} draft={draft} setDraft={setDraft} /> : null}
          {tab === "whitelabel" ? <WhitelabelPanel widget={widget} draft={draft} setDraft={setDraft} /> : null}
        </div>

        <div
          className={cx(
            "flex shrink-0 items-center gap-2 border-t border-line px-4 py-2 transition-colors",
            dirty ? "bg-raised" : "bg-canvas",
          )}
        >
          <span className="text-[11px] text-ink-4">{dirty ? "Unsaved changes" : "All changes saved"}</span>
          <InlineError message={save.error?.message} />
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraftState(emptyDraft(widget))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty} loading={save.status === "loading"} onClick={() => void save.run()}>
              Save changes
            </Button>
          </div>
        </div>
      </section>

      <section className="min-h-0 border-t border-line bg-surface lg:border-t-0" aria-label="Widget preview">
        <WidgetPreview publicKey={widget.public_key} appearance={appearance} dirty={!!dirty} />
      </section>
      <Flash message={flashMessage} />
    </div>
  );
}
