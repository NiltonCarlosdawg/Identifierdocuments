import type { ComponentType, ReactNode } from "react";
import { X } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-docid-text">{title}</h1>
        {description && <p className="mt-1 text-sm text-docid-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  accent = "text-docid-primary-soft",
  badge,
}: {
  label: string;
  value: ReactNode;
  icon: ComponentType<{ className?: string }>;
  accent?: string;
  badge?: string;
}) {
  return (
    <div className="docid-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className={`rounded-lg bg-docid-surface-high p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        {badge && <span className="rounded-full border border-docid-border px-2 py-0.5 text-xs text-docid-muted">{badge}</span>}
      </div>
      <p className="text-sm text-docid-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-docid-text">{value}</p>
    </div>
  );
}

export function StatusChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "error" | "info" | "neutral" }) {
  const tones = {
    success: "border-docid-secondary/30 bg-docid-secondary/10 text-docid-secondary",
    warning: "border-docid-tertiary/30 bg-docid-tertiary/10 text-docid-tertiary",
    error: "border-docid-error/30 bg-docid-error/10 text-docid-error",
    info: "border-docid-primary-soft/30 bg-docid-primary/15 text-docid-primary-soft",
    neutral: "border-docid-border bg-docid-surface-high text-docid-muted",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="docid-panel flex min-h-40 items-center justify-center p-8 text-center text-sm text-docid-muted">
      {children}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  maxWidth = "max-w-2xl",
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className={`docid-panel max-h-[90vh] w-full overflow-hidden ${maxWidth}`}>
        <div className="flex items-center justify-between border-b border-docid-border bg-docid-surface-high/60 px-6 py-4">
          <h2 className="text-lg font-semibold text-docid-text">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-docid-muted transition hover:bg-docid-surface-high hover:text-docid-text">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(90vh-9rem)] overflow-y-auto p-6">{children}</div>
        {footer && <div className="flex justify-end gap-3 border-t border-docid-border bg-docid-surface-high/50 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({ totalLabel }: { totalLabel: string }) {
  return (
    <div className="flex items-center justify-between border-t border-docid-border px-4 py-3 text-sm text-docid-muted">
      <span>{totalLabel}</span>
    </div>
  );
}
