// M4.4 finance in real browsers against the local stack and the MOCK payment provider. Fictional data only; no real
// money moves and payouts are only recorded. Sandbox fee configuration: zero commission, so the partner earns the total.
import { expect, test, type Page } from "@playwright/test";
import { completedBooking, createFixtureUser, db, evidence, grantPlatformRole, signInWithMfa } from "./helpers";

// datetime-local value (to the second) in this machine's timezone (the browser shares it).
const localInput = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

async function financeUser(page: Page) {
  const user = await createFixtureUser();
  await grantPlatformRole(user.id, "FINANCE");
  await signInWithMfa(page, user.email, "/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  return user;
}

test("finance refunds a finished visit, reconciles, and a second person approves a payout paid only with evidence; the manager's statement and CSV agree", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  // Reconcile only this test's payments: earlier specs leave captures the platform never observed, which a wider window
  // would rightly report.
  const startedAt = Math.floor(Date.now() / 1000) * 1000;
  const { venue, hold } = await completedBooking(page, request);
  const [{ partner_id: partnerId }] = (await db()`select partner_id from public.venues where id = ${venue.venueId}::uuid`) as unknown as [{ partner_id: string }];

  // Finance A: refund Rs 50 of the finished visit, charged to the partner.
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await financeUser(a);
  await a.goto(`/admin/bookings/${hold.booking_id}`);
  await expect(a.getByTestId("admin-refund-form")).toContainText("choose who bears this refund");
  await a.getByTestId("refund-amount").fill("50");
  await a.getByTestId("refund-reason").fill("Goodwill for a late table (e2e test).");
  await a.getByTestId("charge-partner").check();
  await a.getByTestId("refund-submit").click();
  await expect(a.getByText("Refund requested.")).toBeVisible();
  const [refund] = await db()`select amount_paise::int as amount_paise, charge_to, status from public.refunds where booking_id = ${hold.booking_id}::uuid and reason_code = 'ADMIN_REFUND'`;
  expect(refund).toMatchObject({ amount_paise: 5000, charge_to: "PARTNER", status: "REQUESTED" });

  // The provider refuses it (no worker in e2e: record the provider's answer the way the worker would). Finance retries
  // the same refund; the partner is still charged once.
  const [{ id: refundId }] = (await db()`select id from public.refunds where booking_id = ${hold.booking_id}::uuid and reason_code = 'ADMIN_REFUND'`) as unknown as [{ id: string }];
  await db()`select app.record_refund_result(${refundId}::uuid, 'FAILED', null, 'PROVIDER_REJECTED')`;
  await a.reload();
  await expect(a.getByTestId("failed-refunds")).toContainText("still owed");
  await a.getByTestId("retry-reason").fill("Provider rejected the first attempt (e2e).");
  await a.getByTestId(`retry-${refundId}`).click();
  await expect(a.getByText("Retry requested.")).toBeVisible();
  const retries = await db()`select status, charge_to from public.refunds where retry_of = ${refundId}::uuid`;
  expect(retries).toEqual([{ status: "REQUESTED", charge_to: null }]);

  // Finance A: a future fee version (needs a second approver), a reconciliation for this test's window, a payout draft.
  await a.goto("/admin/finance/fees");
  const feeVersion = `E2E-FEE-${Date.now().toString(36).toUpperCase()}`;
  await a.getByTestId("fee-version").fill(feeVersion);
  await a.getByTestId("fee-percent").fill("12.5");
  await a.getByTestId("fee-submit").click();
  await expect(a.getByTestId("fee-configs")).toContainText(`${feeVersion}`);
  await expect(a.getByTestId("fee-configs")).toContainText("awaiting another approver");
  await a.goto("/admin/finance");

  await a.getByTestId("reconcile-from").fill(localInput(startedAt));
  await a.getByTestId("reconcile-to").fill(localInput(Date.now() + 60_000));
  await a.getByTestId("reconcile-run").click();
  await expect(a.getByTestId("reconcile-result")).toHaveText("Matched the provider.");
  await a.getByTestId(`draft-payout-${partnerId}`).click();
  await expect(a.getByTestId("payout-batches")).toContainText("Another finance person must approve this draft.");
  const [batch] = (await db()`select id, public_ref, amount_paise::int as amount_paise from public.payout_batches where partner_id = ${partnerId}::uuid`) as unknown as
    [{ id: string; public_ref: string; amount_paise: number }];
  expect(batch.amount_paise).toBe(30000 - 5000);
  await expect(a.getByTestId(`approve-payout-${batch.id}`)).toHaveCount(0);
  await evidence(a, "web-m44-01-finance-draft");

  // Finance B: approves the fee version and the payout, then records the bank reference.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await financeUser(b);
  const [fee] = (await db()`select id from public.fee_configurations where config_version = ${feeVersion}`) as unknown as [{ id: string }];
  await b.goto("/admin/finance/fees");
  await b.getByTestId(`approve-fee-${fee.id}`).click();
  await expect(b.getByTestId("fee-configs")).not.toContainText("awaiting another approver");
  await b.goto("/admin/finance");
  await b.getByTestId(`approve-payout-${batch.id}`).click();
  const card = b.getByTestId(`payout-${batch.public_ref}`);
  await expect(card.getByTestId("payout-status")).toHaveText("approved");
  await expect(b.getByTestId(`mark-paid-${batch.id}`)).toBeDisabled();
  await b.getByTestId(`payout-reference-${batch.id}`).fill("UTR-E2E-0001");
  await b.getByTestId(`mark-paid-${batch.id}`).click();
  await expect(card.getByTestId("payout-status")).toHaveText("paid");
  await expect(card).toContainText("Evidence: UTR-E2E-0001");
  await evidence(b, "web-m44-02-finance-paid");
  await ctxA.close();
  await ctxB.close();

  // The venue manager's statement: the visit earned Rs 300, Rs 50 was charged back, Rs 250 paid, nothing unresolved.
  const manager = await createFixtureUser({ venueRole: { venueId: venue.venueId, role: "MANAGER" } });
  const ctxM = await browser.newContext();
  const m = await ctxM.newPage();
  await signInWithMfa(m, manager.email, `/partner/reports?venue=${venue.venueId}`);
  await expect(m.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(m.getByTestId("statement-earnings")).toContainText(hold.public_ref);
  await expect(m.getByTestId("statement-paid")).toHaveText("₹250.00");
  await expect(m.getByTestId("statement-unresolved")).toHaveText("₹0.00");
  await expect(m.getByTestId("statement-payouts")).toContainText(`${batch.public_ref} · paid`);
  await expect(m.getByTestId("statement-payouts")).toContainText("UTR-E2E-0001");
  await evidence(m, "web-m44-03-partner-statement");

  const csvUrl = await m.getByTestId("statement-csv").getAttribute("href");
  const csv = await m.request.get(csvUrl!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toContain(`Earning,${hold.public_ref},`);
  expect(text).toContain(`Refund adjustment,${hold.public_ref},`);
  expect(text).toContain("300.00");
  // The negative adjustment stays a plain number (only formula-like text is neutralised).
  expect(text).toContain(",-50.00,");
  await ctxM.close();
});

test("finance pages are closed to support, and the statement is closed to staff", async ({ page, browser }) => {
  const support = await createFixtureUser();
  await grantPlatformRole(support.id, "SUPPORT");
  await signInWithMfa(page, support.email, "/admin");
  await expect(page.getByTestId("admin-finance-link")).toHaveCount(0);
  await page.goto("/admin/finance");
  await expect(page.getByTestId("portal-denied")).toBeVisible();
  const response = await page.request.get("/api/v1/admin/finance");
  expect(response.status()).toBe(403);

  const [cafe] = await db()`select id from public.venues where status = 'PUBLISHED' order by created_at limit 1`;
  const staff = await createFixtureUser({ venueRole: { venueId: cafe!.id as string, role: "STAFF" } });
  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await signInWithMfa(s, staff.email, `/partner/reports?venue=${cafe!.id as string}`);
  await expect(s.getByTestId("partner-not-manager")).toBeVisible();
  const statement = await s.request.get(`/api/v1/partner/venues/${cafe!.id as string}/statement?from=2026-11-01&to=2026-11-03`);
  expect(statement.status()).toBe(403);
  await ctx.close();
});
