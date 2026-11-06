// Headless-style UI primitives. Behaviour + accessibility live here; styling is plain Tailwind.

import {
  forwardRef,
  useCallback,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import type { Confidence } from "../api/types";
import { IconAlert, IconCheck, IconUpload } from "./icons";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-zinc-100 text-zinc-950 hover:bg-white border border-zinc-100",
  secondary: "bg-raised text-ink-2 hover:bg-zinc-900 hover:text-ink border border-line-strong",
  ghost: "bg-transparent text-ink-3 hover:text-ink hover:bg-zinc-900 border border-transparent",
  danger: "bg-transparent text-red-400 hover:bg-red-500/10 border border-red-500/30",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] gap-1",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[5px] font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 transition-colors hover:bg-zinc-900 hover:text-ink",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Form controls

const FIELD =
  "w-full rounded-[5px] border border-line-strong bg-canvas px-2.5 text-[13px] text-ink placeholder:text-ink-4 transition-colors hover:border-zinc-700 focus:border-focus focus:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(FIELD, "h-8", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(FIELD, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium uppercase tracking-wide text-ink-4">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-ink-4">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  id,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cx(FIELD, "h-8 appearance-none pr-7", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 6 4.5 4.5L12.5 6' stroke='%2371717a' stroke-width='1.6' fill='none'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[13px] text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-[11px] text-ink-4">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
          checked ? "border-indigo-400 bg-indigo-500" : "border-line-strong bg-zinc-900",
        )}
      >
        <span
          className={cx(
            "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[15px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Tabs (roving tabindex, arrow keys)

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; icon?: ReactNode; badge?: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };
  return (
    <div role="tablist" className={cx("flex items-stretch gap-0 border-b border-line", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b px-3 text-xs font-medium transition-colors",
              selected ? "border-zinc-100 text-ink" : "border-transparent text-ink-4 hover:text-ink-2",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Status + feedback

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cx("animate-spin text-current", className)}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" fill="none" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Progress({
  value,
  tone = "neutral",
  className,
  label,
}: {
  value: number;
  tone?: "neutral" | "ok" | "bad" | "accent";
  className?: string;
  label?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = { neutral: "bg-zinc-300", ok: "bg-emerald-500", bad: "bg-red-500", accent: "bg-indigo-400" }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className={cx("h-[3px] w-full overflow-hidden rounded-full bg-zinc-900", className)}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-300", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "accent";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong text-ink-3 bg-zinc-900/60",
  ok: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  warn: "border-amber-500/30 text-amber-300 bg-amber-500/10",
  bad: "border-red-500/30 text-red-400 bg-red-500/10",
  accent: "border-indigo-400/30 text-indigo-300 bg-indigo-500/10",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[4px] border px-1.5 text-[10.5px] font-medium tabular",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const CONFIDENCE_META: Record<Confidence, { tone: BadgeTone; label: string }> = {
  high: { tone: "ok", label: "High" },
  review: { tone: "warn", label: "Review" },
  unsure: { tone: "bad", label: "Unsure" },
  pending: { tone: "neutral", label: "Pending" },
};

export function ConfidenceTag({ value }: { value: Confidence }) {
  const meta = CONFIDENCE_META[value];
  return (
    <Badge tone={meta.tone}>
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          { ok: "bg-emerald-400", warn: "bg-amber-300", bad: "bg-red-400", neutral: "bg-zinc-500", accent: "bg-indigo-300" }[
            meta.tone
          ],
        )}
      />
      {meta.label}
    </Badge>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-line-strong bg-zinc-900 px-1 font-mono text-[10px] text-ink-4">
      {children}
    </kbd>
  );
}

export function InlineError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[5px] border border-red-500/25 bg-red-500/5 px-2.5 py-2 text-xs text-red-300">
      <IconAlert size={13} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-4">{icon}</div> : null}
      <p className="text-[13px] font-medium text-ink-2">{title}</p>
      {body ? <p className="max-w-xs text-xs text-ink-4">{body}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h2>
        {meta}
      </div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Dropzone

export function Dropzone({
  onFiles,
  accept,
  label = "Drop files or click to upload",
  hint,
  disabled,
  compact,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const handle = useCallback(
    (list: FileList | null) => {
      if (list && list.length > 0) onFiles(Array.from(list));
    },
    [onFiles],
  );
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) handle(event.dataTransfer.files);
      }}
      className={cx(
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[6px] border border-dashed text-center transition-colors",
        compact ? "px-3 py-3" : "px-4 py-5",
        over ? "border-indigo-400 bg-indigo-500/5" : "border-line-strong hover:border-zinc-600 hover:bg-zinc-900/40",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <IconUpload size={15} className="text-ink-4" />
      <span className="text-xs text-ink-2">{label}</span>
      {hint ? <span className="text-[10.5px] text-ink-4">{hint}</span> : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          handle(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Toast-like flash

export function useFlash(timeoutMs = 2200): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback(
    (next: string) => {
      setMessage(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), timeoutMs);
    },
    [timeoutMs],
  );
  return [message, flash];
}

export function Flash({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 animate-fade-in items-center gap-2 rounded-[6px] border border-line-strong bg-raised px-3 py-2 text-xs text-ink shadow-2xl shadow-black/60"
    >
      <IconCheck size={13} className="text-emerald-400" />
      {message}
    </div>
  );
}
