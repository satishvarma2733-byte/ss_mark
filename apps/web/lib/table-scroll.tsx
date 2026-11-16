import type { ReactNode } from "react";

// Wide tables scroll sideways inside their own region on narrow screens instead of widening the page (WCAG 1.4.10).
// The region is named and focusable so keyboard users can scroll it too (WCAG 2.1.1).
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
