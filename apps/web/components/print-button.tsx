"use client";

// Opens the browser's print dialog, where the receipt can be printed or saved as a PDF.
export function PrintButton({ label, className = "button secondary" }: { label: string; className?: string }) {
  return (
    <button className={className} type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
