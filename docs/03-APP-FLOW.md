# Simply Sit — App Flow

Version 1.0 · 25 October 2026 · Customer website + Android + iOS first release confirmed

This flow implements PRD-01–13. All C screens and actions apply to the customer website and native Android/iOS apps; the route is the canonical web/deep-link resource, not a requirement to embed a website in the apps. P/A portals are responsive web. Public browsing is allowed; sign-in is required before a hold, booking or personal action. Role assignments come from the server. A customer may also hold a venue role, but changing workspace never expands permissions.

## 1. Entry, navigation and screen inventory

Entry points: public home/search, shared venue link, booking link in email, staff invitation, partner application and operator login. Booking and invitation links require authentication and authorization before showing private information; QR tokens never expose customer data publicly.

| Screen ID / route | Purpose and required data |
|---|---|
| C01 `/` | “YOUR SPACE. YOUR TIME.”, manual area search, optional location, date/start/duration/party size/use case |
| C02 `/sign-in` | Email OTP request/verify (proposed), terms/privacy links and safe return route |
| C03 `/venues` | Available hospitality-venue list/map, use-case/category/environment filters, price basis, distances where available |
| C04 `/venues/:slug` | Approved listing, photos, address, bookable windows, amenities, capacities, access restrictions, food/delivery status and reviews |
| C05 `/venues/:slug/book` | Date/time/party/table selection, live availability, priced end time, quote/policy review and explicit acceptance before creating a hold |
| C06 `/checkout/:holdId` | Server hold expiry, itemized total, policy acceptance, gateway action |
| C07 `/payment/return` | Pending/success/failure recovery; server status lookup, no client confirmation |
| C08 `/bookings/:id` | Owner-only confirmation, QR/PIN, time, rules, directions, receipt, lifecycle and actions |
| C09 `/bookings` | Upcoming, past and cancelled bookings; state labels and receipt links |
| C10 `/bookings/:id/cancel` | Accepted policy, refund preview, reason (optional customer), confirmation |
| C11 `/bookings/:id/extend` | Request, staff decision, fresh availability/quote, extension payment/status |
| C12 `/bookings/:id/review` | Eligible booking, rating, optional text, submitted/moderated status |
| C13 `/help`, `/support/:id` | FAQ, category, optional owned booking, description and ticket status |
| C14 `/account` | Minimal profile, consent preferences, sign-out, deletion/export request |
| P01 `/partner/apply` | Business/contact, venue proposal, operational rules, secure payout onboarding link |
| P02 `/partner` | Assigned venue switcher, today's arrivals, readiness, alerts and application status |
| P03 `/partner/venue` | Profile/photos/amenities/food rules, draft and approval state |
| P04 `/partner/inventory` | Physical tables/capacity/base prices; hours, buffers and blackout configuration |
| P05 `/partner/calendar` | Day/week reservations, holds, closures and table readiness |
| P06 `/partner/bookings/:id` | Minimal customer information, scan/manual verification, arrivals, checkout, extension and incident actions |
| P07 `/partner/reports` | Authorized venue booking and settlement statements, exports |
| P08 `/partner/staff` | Manager-only invitations, roles, revocation and staff audit |
| A01 `/admin` | Operational metrics, payment failures and support backlog |
| A02 `/admin/venues/:id` | Application evidence, approve/request changes/suspend and reasons |
| A03a `/admin/bookings` | Restricted booking lookup by reference, venue, service time, customer identifier or payment state |
| A03 `/admin/bookings/:id` | Restricted lookup, timeline, payment/refund history and service recovery |
| A04 `/admin/support/:id` | Ticket/incident triage, moderation, decision history and response record |
| A05 `/admin/finance` | Refund queue, reconciliation exceptions, settlements and dated fee versions |
| S01 shared utility | Not found, unauthorized, expired link, service unavailable, offline and maintenance states |

Customer compact-web/native navigation: Explore, Bookings, Help, Account. Partner navigation: Today, Calendar, Inventory, Venue, Reports; manager-only Staff. Admin uses a separate sidebar. Hide inaccessible actions and still enforce permissions on every server request. Browser Back and native system Back restore prior criteria/scroll; checkout Back cannot extend a hold. Protect unsaved partner edits. Only allow internal, validated sign-in return paths. Universal/App Links open an authorized resource in an installed app, with web fallback; unverified URLs cannot invoke privileged actions. Preserve query/booking context after app installation or sign-in where safely possible.

## 2. Main journeys

```text
First visit → C01 search (work/meet/wait/study/gather/relax)
→ C03 hospitality venues → C04 rules/bookable windows → C05 table/time
→ C02 sign-in if needed → fresh availability check → C06 hold/summary
→ provider checkout → C07 verified result → C08 confirmed booking
→ P06 staff check-in → end reminder → leave or C11 request extension
→ P06 checkout → table cleaning → staff ready → C12 review

Partner invitation/application → P01 draft → submit → A02 review
→ changes requested / approved → P03+P04 configured → publish → P02 operate
```

No account creation is needed to see venue policies or prices. First sign-in collects email only; request a display name at booking if required for service. Location access and marketing consent are optional and separate from required terms acceptance. No preselected consent. Do not present universal BYO-food permission: show each venue's allowed/restricted/prohibited rules before selection and payment.

## 3. Action contract

All mutations disable duplicate submission while pending, use server authorization/validation, retain a stable operation ID, and expose an accessible status. Preserve form input on recoverable failure. On an uncertain network response, fetch the operation's status before retrying. Never replace an ambiguous payment outcome with a new charge attempt.

| Trigger / screen | Validation | Loading | Success / next | Failure / next |
|---|---|---|---|---|
| Search C01/C03 | Area or coordinates; proposed lead ≥15min/horizon ≤30days; duration 60–240min in 30min increments; positive party size | Results skeleton with query retained | C03 matching list/map | Inline invalid fields; no-results offers explicit filter changes; never silently changes date |
| Use my location C01 | Browser permission requested after tap | Locating indicator; manual input remains | Area populated; submit/search | Denied/timeout: manual area entry; no repeated prompt |
| Filter / list-map toggle C03 | Supported filters, verified accessibility claims | Update announcement, preserve viewport/list | C03 refreshed; URL query stores criteria | Keep prior results visibly stale; Retry; map failure leaves list available |
| Open venue C03/link | Published listing; requested date retained | Detail skeleton | C04 policy/amenity view | Unpublished/unavailable: explanation and return to C03 |
| Select table/time C05 | Capacity, open hours, lead time, increments, buffer and exact availability | Quote refresh; pay disabled | Selected table, itemized quote and end time | Conflict shows alternatives; cannot add extra people over capacity |
| Request OTP C02 | Email format; rate limit; required terms acknowledgement where account created | Send button busy | Code input and resend timer | Neutral account message; cooldown/provider error; retained email |
| Verify / resend C02 | Code length/expiry/attempt limit; resend cooldown | Verify/resend busy | Session established; return to prior selection then revalidate | Invalid/expired: inline retry or resend; no leaked account existence |
| Continue to checkout C05 | Signed in; full quote/rules shown; explicit policy acceptance; server recalculates quote and availability | Atomic hold creation | C06 with server expiry and accepted quote/policy version | Occupied: C05 alternatives; changed amount/rules require renewed review; auth expiry: C02 then fresh check |
| Pay C06 | Active hold, current total, explicit policy acceptance | Provider opens; button busy | C07 pending verification | Provider unavailable: preserve active hold and retry; expiry: C05 refresh |
| Provider web/app return / status refresh C07 | Owned operation, trusted server status; validated return link | “Verifying payment”; refresh allowed | C08 only after confirmed record | Failed: retry only with explicit terminal state and valid/new hold; late paid/conflict: recovery/refund case, support link |
| Leave/cancel gateway | Provider outcome may be unknown | Server checks status first | Pending C07, or C06 if unpaid and hold active | Expired/unpaid: C05; never show cancellation as confirmed payment failure without verification |
| Open booking / receipt C08/C09 | Ownership or assigned operational role | Detail/document loading | C08 or receipt view | Unauthorized: S01; receipt failure retries without recreating payment |
| Cancel preview C08 → C10 | Cancellable state; accepted policy; server cutoff | Calculate exact refund | C10 amount and consequence | Not eligible/state changed: current C08 and support route |
| Confirm cancellation C10 | Revalidate state and preview amount; reconfirm if changed | One idempotent cancellation operation | C08 cancelled + refund pending/none; updates sent | Unknown response: recover operation; provider failure leaves explicit refund issue, support case |
| Request extension C11 | Checked in before original end; proposed increment; final total duration ≤240min | Availability/request status | Await staff decision; C11 timeline/deadline | No capacity/ended: explain and keep C08 original end time |
| Staff approve/decline P06 | Assigned role; request decision deadline not passed; original booking active; approve only while extension appears feasible | Decision busy | Customer notified; approval has new five-minute deadline to start a hold | Stale/expired: refresh; reason shown for decline; original booking unchanged |
| Pay approved extension C11 | Fresh quote; atomic hold created before approval expiry; capacity including buffer; active hold deadline before original end | Gateway + server verification | C08 revised end time/receipt, one committed extension | Conflict/expiry/payment failure: original remains; paid conflict enters recovery/refund |
| Scan / enter booking P06 | Camera only after action; opaque QR secret verified against server hash or rate-limited ID/PIN with secondary verification; correct venue/date/state | Verify booking | Minimal matched arrival details | Denied camera: manual ID/PIN; invalid/wrong venue: generic rejection, retry/support |
| Check in P06 | Valid confirmed booking, grace policy; ready table; staff scope | Commit once | Checked in timestamp, staff identity; P06 | Already checked in: existing success; late/dirty/conflict: block, explain and support override with reason |
| Mark no-show P06 | Grace elapsed; no check-in; staff confirmation | Commit once | No-show recorded; inventory remains allocated through scheduled end/buffer | State changed: refresh; cannot auto-resell |
| Checkout P06 | Checked-in booking; permitted staff | Commit checkout | Booking ended; table becomes cleaning; P02/P05 | Repeated action shows existing result; no automatic early-release/refund |
| Mark ready P05/P06 | Cleaning state; assigned staff; earlier completion cannot shorten configured reserved interval/buffer | Save readiness | Ready indicator; next eligible arrival can check in | State mismatch: refresh; absent readiness raises operational alert |
| Submit review C12 | Own completed booking; rating 1–5, bounded text, one review | Save once | Submitted/moderation state; C08 | Ineligible/duplicate/invalid: clear error; text retained |
| Submit support C13 | Category, bounded description, owned booking if linked | Ticket creation | Reference, priority expectations and ticket detail | Save failure: retain draft; urgent danger copy directs immediate local assistance |
| Save/submit application P01 | Required business/contact/address/capacity/rules; provider handles payout credentials | Draft save or submission busy | Draft saved / review pending; P02 | Per-field errors; upload retry; never publish incomplete draft |
| Save venue/inventory P03/P04 | Manager scope, valid capacities/prices, rules, non-overlapping hours | Save/version busy | Saved draft or published permitted version | Preserve input; material rule changes return to review as configured |
| Add closure P05 | Valid interval and venue-local time; manager scope; no overlap with active holds/confirmed/occupied claims | Atomic conflict check | Nonconflicting closure saved and blocks new sales | Conflict: closure not committed; list permitted references; pause new resource sales, route to A03/P06 explicit resolution, then retry; never silently cancel |
| Invite/revoke staff P08 | Manager scope; known role; no unauthorized escalation | Invitation/revocation busy | Role-scoped invite sent or access revoked | Expired/in-use invitation: explicit state; revoke failure retains current role state |
| Approve/suspend A02 | Authorized admin; required reason; eligibility evidence | Save with audit | Listing state updated; affected future bookings flagged | Unauthorized/state mismatch: block; suspension alone does not erase reservations |
| Search bookings A03a | Authorized capability; bounded search fields/date range | Scoped result loading | Match list → A03 detail | No matches: refine filters; denied/private references disclose no record; network retry preserves query |
| Admin refund A03/A05 | Financial permission; refundable balance; reason; provider eligibility | Request + provider pending | Audited pending, then confirmed provider status | Uncertain/failure: exception queue; no duplicate request or false “refunded” |
| Resolve ticket/moderate A04 | Permission, reason and resolution classification | Save | Timeline and visibility updated | Preserve record; retry safely; never delete audit trail |
| Export/report/fee change P07/A05 | Venue/finance scope; valid date range; fee effective date | Export/config version status | Scoped report or future fee version saved | Retry/export limit; prior booking snapshots unaffected |
| Sign out / deletion C14 | Active session; deletion explanation and retention handling | Revoke session / create request | Signed out / request reference | Retry safely; legal/financial retention explained before confirmation |
| Resume app / foreground C06–C11 | Session and operation ownership; refresh authoritative time/status | “Updating booking status” when needed | Current hold, booking/payment/refund state; resume correct screen | Offline/expired session: show stale indicator and safe next action; never restart a charge automatically |

Extension has three **P: distinct phase deadlines**. Staff decide within five minutes of request creation. Approval then gives the customer five minutes from the staff decision to start a fresh atomic hold. The hold, if created in time, has its own deadline at the earlier of hold creation + five minutes or the original booking end; later request/approval expiry does not shorten an active hold. Approval never guarantees availability before the hold succeeds. Show the current phase and exact server deadline, with no paid extension started after the original end. If this protocol changes, update UX, API and schema together before coding.

## 4. Common states and alternate journeys

Empty bookings show Explore; empty venue search suggests removing a named filter without changing it automatically. Draft/pending/suspended venues show the manager the reason and next action; customers see only published listings. An empty partner calendar still shows hours, closures and readiness.

Offline browsing labels cached content as possibly stale. Disable booking, payment, arrival and financial mutations until connectivity returns; do not queue them silently. After reconnect, refresh authoritative availability and operation status. A global failure page preserves safe navigation and support access.

Customer cancels checkout → inventory expires or is released after authoritative unpaid status. Customer edits selection → return to C05 and create a fresh quote/hold. Session expiry → C02 then recheck inventory. A venue closes/table fails → staff escalate; offer an alternative only with explicit customer agreement or initiate the approved refund. Proposed reminder occurs ten minutes before the committed end, includes the absolute end time, and is rescheduled after extension; availability is never promised in a notification. At end time without staff checkout, show “Ended — checkout pending” and create an operational follow-up; do not auto-complete the booking or auto-mark the table ready.

Native apps request location/camera permissions at the related action and offer manual alternatives. Payment app switching, app termination, cancelled return links and background expiry all recover via server status on resume. Keep authenticated secrets in platform secure storage; user-facing errors never reveal tokens. App-store review/access test accounts and real-device payment/deep-link QA are release requirements, not customer onboarding screens.

Deep links open the requested authorized resource after sign-in. Used/expired invitation links offer a fresh invitation request. Not-found and unauthorized screens avoid disclosing whether another user's booking exists. Admin emergency overrides require a reason and audit; no override may bypass the database overlap invariant.
