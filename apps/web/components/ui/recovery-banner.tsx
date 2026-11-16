import Link from "next/link";
import { Alert, type Tone } from "./feedback";

export type SystemRecoveryKind =
  | "payment_pending"
  | "payment_failed"
  | "hold_expired"
  | "slot_unavailable"
  | "extension_unavailable"
  | "offline_pass";

const COPY: Record<
  SystemRecoveryKind,
  { tone: Tone; title: string; description: string; actionLabel?: string; actionHref?: string }
> = {
  payment_pending: {
    tone: "warning",
    title: "Payment verification pending",
    description: "We are waiting for confirmation from the payment provider. Refresh this page or check My bookings shortly."
  },
  payment_failed: {
    tone: "error",
    title: "Payment could not be completed",
    description: "No charge was confirmed. You can retry checkout while your hold is active or pick another slot."
  },
  hold_expired: {
    tone: "warning",
    title: "Checkout hold expired",
    description: "Your temporary table hold timed out before payment completed. Return to the venue to select an available slot.",
    actionLabel: "Browse spaces",
    actionHref: "/venues"
  },
  slot_unavailable: {
    tone: "error",
    title: "Selected slot is no longer available",
    description: "Another guest reserved this table or time window. Choose another available time or table."
  },
  extension_unavailable: {
    tone: "warning",
    title: "Extension unavailable",
    description: "This table is reserved for another booking immediately after your current end time."
  },
  offline_pass: {
    tone: "neutral",
    title: "Offline cached booking pass",
    description: "You appear offline. Show your booking reference and arrival PIN to venue staff if live status cannot refresh."
  }
};

export function RecoveryBanner({
  kind,
  actionLabel,
  actionHref,
  onRetry
}: {
  kind: SystemRecoveryKind;
  actionLabel?: string;
  actionHref?: string;
  onRetry?: () => void;
}) {
  const cfg = COPY[kind];
  const label = actionLabel ?? cfg.actionLabel;
  const href = actionHref ?? cfg.actionHref;

  return (
    <Alert
      tone={cfg.tone}
      title={cfg.title}
      action={
        onRetry ? (
          <button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={onRetry}>
            {label ?? "Try again"}
          </button>
        ) : href && label ? (
          <Link className="ss-btn ss-btn--secondary ss-btn--sm" href={href}>
            {label}
          </Link>
        ) : null
      }
    >
      {cfg.description}
    </Alert>
  );
}
