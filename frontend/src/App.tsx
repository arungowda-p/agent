import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import type { Health } from "./shared/api/types";
import { useAgentAPI, useResource } from "./shared/hooks/useAgentAPI";
import { IconBook, IconChat, IconDot, IconLogo, IconShield } from "./shared/ui/icons";
import { cx, Kbd, Spinner } from "./shared/ui/primitives";

const QuestionnaireAutopilot = lazy(() => import("./apps/questionnaire-autopilot/QuestionnaireAutopilot"));
const SiteSupportAgent = lazy(() => import("./apps/site-support-agent/SiteSupportAgent"));
const StudyCopilot = lazy(() => import("./apps/study-copilot/StudyCopilot"));

type ModuleId = "questionnaire" | "support" | "study";

const MODULES: { id: ModuleId; label: string; short: string; icon: ReactNode; key: string }[] = [
  { id: "questionnaire", label: "Questionnaire Autopilot", short: "Autopilot", icon: <IconShield size={13} />, key: "1" },
  { id: "support", label: "Site Support Agent", short: "Support", icon: <IconChat size={13} />, key: "2" },
  { id: "study", label: "Study Copilot", short: "Study", icon: <IconBook size={13} />, key: "3" },
];

function readHash(): ModuleId {
  const value = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return MODULES.some((m) => m.id === value) ? (value as ModuleId) : "questionnaire";
}

function useModuleRoute(): [ModuleId, (id: ModuleId) => void] {
  const [active, setActive] = useState<ModuleId>(readHash);
  useEffect(() => {
    const onHash = () => setActive(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((id: ModuleId) => {
    window.location.hash = `/${id}`;
  }, []);
  return [active, navigate];
}

function TenantSwitcher() {
  const { tenant, setTenant } = useAgentAPI();
  const [draft, setDraft] = useState(tenant);
  useEffect(() => setDraft(tenant), [tenant]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setTenant(draft);
      }}
      className="hidden items-center gap-1.5 md:flex"
    >
      <label htmlFor="tenant" className="text-[11px] text-ink-4">
        Workspace
      </label>
      <input
        id="tenant"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setTenant(draft)}
        spellCheck={false}
        className="h-6 w-28 rounded-[4px] border border-line-strong bg-canvas px-2 font-mono text-[11px] text-ink-2 focus:border-focus focus:outline-none"
      />
    </form>
  );
}

function HealthIndicator() {
  const { data, error } = useResource<Health>("/api/health", { pollMs: 30000, persist: false });
  const online = !!data && !error;
  const offlineLLM = data?.llm.startsWith("offline");
  return (
    <div
      className="hidden items-center gap-1.5 text-[11px] text-ink-4 lg:flex"
      title={data ? `LLM: ${data.llm}\nEmbeddings: ${data.embeddings}\nStorage: ${data.storage}` : "API unreachable"}
    >
      <IconDot className={online ? (offlineLLM ? "text-amber-400" : "text-emerald-400") : "text-red-500"} size={7} />
      <span>{!online ? "API offline" : offlineLLM ? "Extractive mode" : data.llm}</span>
      {online ? <span className="text-zinc-700">·</span> : null}
      {online ? <span>{data.storage}</span> : null}
    </div>
  );
}

export default function App() {
  const [active, navigate] = useModuleRoute();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      const target = MODULES.find((m) => m.key === event.key);
      if (target) {
        event.preventDefault();
        navigate(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  useEffect(() => {
    const current = MODULES.find((m) => m.id === active);
    document.title = current ? `${current.label} · Agent Suite` : "Agent Suite";
  }, [active]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
        <div className="flex items-center gap-2 pr-1">
          <span className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-line-strong bg-raised text-ink">
            <IconLogo size={13} />
          </span>
          <span className="hidden text-[13px] font-semibold tracking-tight text-ink sm:inline">Agent Suite</span>
        </div>
        <span className="h-4 w-px bg-line-strong" aria-hidden="true" />
        <nav aria-label="Applications" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {MODULES.map((module) => {
            const selected = module.id === active;
            return (
              <button
                key={module.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => navigate(module.id)}
                className={cx(
                  "group inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] border px-2.5 text-xs font-medium transition-colors",
                  selected
                    ? "border-line-strong bg-raised text-ink"
                    : "border-transparent text-ink-4 hover:bg-zinc-900 hover:text-ink-2",
                )}
              >
                <span className={selected ? "text-ink" : "text-ink-4 group-hover:text-ink-3"}>{module.icon}</span>
                <span className="hidden sm:inline">{module.label}</span>
                <span className="sm:hidden">{module.short}</span>
                <span className="hidden xl:inline-flex">
                  <Kbd>⌥{module.key}</Kbd>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <HealthIndicator />
          <TenantSwitcher />
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-ink-4">
              <Spinner />
            </div>
          }
        >
          {active === "questionnaire" ? <QuestionnaireAutopilot /> : null}
          {active === "support" ? <SiteSupportAgent /> : null}
          {active === "study" ? <StudyCopilot /> : null}
        </Suspense>
      </main>
    </div>
  );
}
