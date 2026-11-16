import type { AnchorHTMLAttributes, ElementType, HTMLAttributes, ReactNode } from "react";

// Surfaces, status labels, filter chips and tab rows. Like Button, these render the established classes in
// app/globals.css so there is one visual system (Figma "SS / Card" 94:341, "SS / Status indicator", "SS / Tabs" 94:419).

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render; a labelled region should stay a `section`. */
  as?: ElementType;
}

export function Card({ as: Tag = "section", className = "", children, ...rest }: CardProps) {
  return (
    <Tag className={`card ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

export type PillTone = "success" | "neutral" | "warm" | "warning" | "sage" | "danger";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** `success` is the default green label; the text always names the state, colour is not the only signal. */
  tone?: PillTone;
}

export function StatusPill({ tone = "success", className = "", children, ...rest }: StatusPillProps) {
  return (
    <span className={["status-pill", tone === "success" ? "" : tone, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </span>
  );
}

// A link chip; mark the selected one with aria-current ("true" or "page").
export function FilterChip({ className = "", children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={`chip ${className}`.trim()} {...rest}>
      {children}
    </a>
  );
}

export interface TabItem {
  href: string;
  label: ReactNode;
  current?: boolean;
}

export function Tabs({ label, items, className = "" }: { label: string; items: TabItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={`tabs ${className}`.trim()}>
      {items.map((item) => (
        <a key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
