import Link from "next/link";
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warning" | "error" | "sage";

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`ss-badge ss-badge--${tone} ${className}`.trim()}>{children}</span>;
}

export function StatusIndicator({ tone = "neutral", label }: { tone?: Tone; label: string }) {
  return (
    <span className={`ss-status ss-badge--${tone}`}>
      <span className="ss-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Alert({
  tone = "neutral",
  title,
  children,
  action
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`ss-alert ss-alert--${tone}`} role={tone === "error" || tone === "warning" ? "alert" : "status"}>
      <div className="ss-alert__body">
        {title ? <strong className="ss-alert__title">{title}</strong> : null}
        <div className="ss-alert__text">{children}</div>
      </div>
      {action ? <div className="ss-alert__action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ss-empty">
      {icon ? <div className="ss-empty__icon" aria-hidden="true">{icon}</div> : null}
      <h3 className="ss-empty__title">{title}</h3>
      <p className="ss-empty__desc">{description}</p>
      {action ? <div className="ss-empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      tone="error"
      title={title}
      action={
        onRetry ? (
          <button type="button" className="button secondary sm" onClick={onRetry}>
            Try again
          </button>
        ) : null
      }
    >
      {description}
    </Alert>
  );
}

export function Skeleton({ width = "100%", height = 18, rounded = false }: { width?: string | number; height?: number; rounded?: boolean }) {
  return <span className={`ss-skeleton ${rounded ? "ss-skeleton--round" : ""}`} style={{ width, height }} aria-hidden="true" />;
}

export function KpiCard({ label, value, meta }: { label: string; value: string | number; meta?: string }) {
  return (
    <div className="ss-kpi">
      <span className="ss-kpi__label">{label}</span>
      <strong className="ss-kpi__value">{value}</strong>
      {meta ? <span className="ss-kpi__meta">{meta}</span> : null}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="ss-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, idx) => (
          <li key={`${item.label}-${idx}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange
}: {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="ss-pagination" aria-label="Pagination">
      <button type="button" className="button secondary sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span className="ss-pagination__info">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="button secondary sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="ss-tooltip-wrap" title={text}>
      {children}
    </span>
  );
}
