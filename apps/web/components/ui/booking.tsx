import type { ReactNode } from "react";

// Booking widgets (Figma "SS / Date picker" 94:324, "SS / Time selector" 94:334, "SS / QR booking card" 2019:100).
// No hooks, so they render in server components and work inside plain GET forms.

// "2026-11-12" -> "Today · Thu 12 Nov". The submitted value stays the ISO date.
export function friendlyDate(iso: string, today?: string) {
  const text = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return iso === today ? `Today · ${text}` : text;
}

interface PickerProps {
  id: string;
  name: string;
  label: ReactNode;
  value: string;
}

export function DatePicker({ id, name, label, value, dates, today }: PickerProps & { dates: string[]; today?: string }) {
  return (
    <div className="ss-picker">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className="input" defaultValue={value}>
        {dates.map((d) => (
          <option key={d} value={d}>
            {friendlyDate(d, today)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TimeSelector({ id, name, label, value, times, labels }: PickerProps & { times: string[]; labels?: Record<string, string> }) {
  return (
    <div className="ss-picker">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} className="input" defaultValue={value}>
        {times.map((t) => (
          <option key={t} value={t}>
            {labels?.[t] ?? t}
          </option>
        ))}
      </select>
    </div>
  );
}

// The check-in credential: QR code, PIN and one line of guidance. `qrSvg` is trusted markup built by lib/qr.ts.
export function QrBookingCard({ qrSvg, pin, hint, pinTestId }: { qrSvg: string; pin: string; hint: ReactNode; pinTestId?: string }) {
  return (
    <div className="pass-credential">
      <div className="pass-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      <p className="pass-pin" aria-label={`PIN ${pin}`}>
        <span className="pin" data-testid={pinTestId}>
          {pin}
        </span>
      </p>
      <p className="book-when">{hint}</p>
    </div>
  );
}
