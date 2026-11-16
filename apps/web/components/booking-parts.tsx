// Shared booking blocks from the Figma customer frames: the venue identity panel (photo, venue, table, reference) and
// the itemized payment summary. Display only; prices come from the booking's immutable snapshot.
import type { ReactNode } from "react";
import type { PriceSnapshot } from "@simply-sit/contracts";
import { formatInrPaise } from "../lib/format";
import { VenuePhoto } from "./venue-photo";

export const longDate = (iso: string, timeZone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

const hoursLabel = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}` : `${minutes} min`);

export function VenueIdentity({
  photo,
  venueName,
  detail,
  reference
}: {
  photo: { id: string; alt_text: string } | null;
  venueName: string;
  detail: string;
  reference: string;
}) {
  return (
    <div className="venue-identity">
      <VenuePhoto mediaId={photo?.id ?? null} alt="" className="venue-identity-photo" width={128} height={140} placeholderText="No venue photo" />
      <div>
        <p className="venue-identity-name">{venueName}</p>
        <p className="venue-identity-detail">{detail}</p>
        <p className="venue-identity-ref">{reference}</p>
      </div>
    </div>
  );
}

export function PriceSummary({
  price,
  totalLabel = "Total to pay",
  totalPaise,
  children,
  totalTestId
}: {
  price: PriceSnapshot;
  totalLabel?: string;
  totalPaise?: number;
  children?: ReactNode;
  totalTestId?: string;
}) {
  return (
    <dl className="detail-rows">
      <div>
        <dt>
          Table · {formatInrPaise(price.hourly_paise)} × {hoursLabel(price.duration_minutes)}
        </dt>
        <dd>{formatInrPaise(price.base_paise)}</dd>
      </div>
      <div>
        <dt>Platform fee</dt>
        <dd>{formatInrPaise(price.service_fee_paise)}</dd>
      </div>
      <div>
        <dt>Taxes</dt>
        <dd>{price.tax_lines.length === 0 ? "Not configured" : "Included"}</dd>
      </div>
      {children}
      <div className="total-row">
        <dt>{totalLabel}</dt>
        <dd className="price" data-testid={totalTestId}>
          {formatInrPaise(totalPaise ?? price.total_paise)}
        </dd>
      </div>
    </dl>
  );
}
