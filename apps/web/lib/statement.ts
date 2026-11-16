// P07 partner statement export. CSV cells that a spreadsheet would execute are neutralised (packages/domain csv).
import type { PartnerStatement } from "@simply-sit/contracts";
import { paiseToRupeeText, toCsv, type CsvValue } from "@simply-sit/domain";

export function statementCsv(statement: PartnerStatement): string {
  const rows: CsvValue[][] = [
    ["Simply Sit partner statement", statement.venue.name],
    ["Period", `${statement.from} to ${statement.to}`, "Timezone", statement.venue.timezone],
    ["Amounts in INR. Lines not yet in a PAID payout are unresolved."],
    [],
    ["Type", "Booking", "Booking start", "Booking status", "Gross", "Platform fee", "Your amount", "Date", "Payout", "Payout status"]
  ];
  for (const e of statement.earnings) {
    rows.push(["Earning", e.public_ref, e.start_at, e.booking_status, paiseToRupeeText(e.gross_paise), paiseToRupeeText(e.platform_fee_paise),
               paiseToRupeeText(e.partner_paise), e.earned_at, e.payout_ref, e.payout_status]);
  }
  for (const a of statement.adjustments) {
    rows.push(["Refund adjustment", a.public_ref, null, null, null, null, paiseToRupeeText(-a.amount_paise), a.created_at, a.payout_ref,
               a.payout_status]);
  }
  rows.push([]);
  rows.push(["Payout", "Status", "This venue", "Created", "Paid", "Evidence reference"]);
  for (const p of statement.payouts) {
    rows.push([p.public_ref, p.status, paiseToRupeeText(p.venue_amount_paise), p.created_at, p.paid_at, p.evidence_ref]);
  }
  const t = statement.totals;
  rows.push([]);
  rows.push(["Totals", "Gross", paiseToRupeeText(t.gross_paise), "Platform fees", paiseToRupeeText(t.platform_fee_paise)]);
  rows.push(["", "Your earnings", paiseToRupeeText(t.earned_paise), "Refund adjustments", paiseToRupeeText(-t.adjustments_paise)]);
  rows.push(["", "Paid", paiseToRupeeText(t.paid_paise), "Unresolved", paiseToRupeeText(t.unresolved_paise)]);
  return toCsv(rows);
}
