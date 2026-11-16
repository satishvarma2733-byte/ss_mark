# Simply Sit — API Contracts, State Machines and Failure Recovery

Planning contract 1.0 · 25 October 2026. **Proposed**, with no implemented endpoints. Website, Android and iOS customer clients use the same domain API and transition rules. PRD trace: PRD-01 identity; PRD-02 discovery; PRD-03 venue/rules; PRD-04 inventory; PRD-05 checkout; PRD-06 cancellation; PRD-07 operations; PRD-08 extensions; PRD-09 partner setup; PRD-10 admin; PRD-11 notifications; PRD-12 finance; PRD-13 review/support. All commercial defaults remain pending decisions in `00-SOURCE-REVIEW-AND-DECISIONS.md`.

## 1. Common contract

Base path `/api/v1`. JSON field names are `snake_case`; IDs are UUIDs except opaque public references/provider IDs; instants are RFC 3339 UTC strings, e.g. `2026-10-26T04:30:00Z`; money is integer paise with currency. Return venue timezone and readable local time separately. Cursor pagination defaults to 20, max 100; allowlist sort/filter values. Enforce body-size limits and reject unknown fields on mutations. A server-generated `request_id` is returned in a header and body for support.

Protected web calls use validated session cookies and origin/CSRF controls. Native calls use a verified bearer access token. Reject ambiguous competing identities. Every route checks active account, capability, venue membership and record ownership; another tenant's private record returns 404. Public search returns published venue data only. A privileged server credential does not replace these checks. Server actions call the same services and return the same domain errors.

```json
{"data":{"booking_id":"uuid","booking_status":"PENDING_PAYMENT"},"request_id":"uuid"}
```

```json
{"error":{"code":"SLOT_UNAVAILABLE","message":"This table is no longer available. Choose another time.","retryable":false,"field_errors":{}},"request_id":"uuid"}
```

| HTTP | Stable domain codes / behavior |
|---|---|
| 400 | MALFORMED_REQUEST, INVALID_CURSOR; reject before mutation. |
| 401 | AUTH_REQUIRED, SESSION_EXPIRED; reauthenticate, then revalidate quote. |
| 403 | FORBIDDEN, ACCOUNT_SUSPENDED, REAUTH_REQUIRED; never rely on a hidden UI action. |
| 404 | NOT_FOUND; includes unowned private IDs. |
| 409 | SLOT_UNAVAILABLE, STALE_VERSION, QUOTE_CHANGED, INVALID_TRANSITION, IDEMPOTENCY_CONFLICT, OPERATION_IN_PROGRESS; return safe current version/state where authorized. |
| 410 | HOLD_EXPIRED, QUOTE_EXPIRED, EXTENSION_EXPIRED; restart that reservation step. |
| 422 | VALIDATION_FAILED, PARTY_TOO_LARGE, OUTSIDE_HOURS, POLICY_NOT_ACCEPTED, POLICY_NOT_CONFIGURED, PAYMENT_AMOUNT_MISMATCH; field-specific recovery. |
| 429 | RATE_LIMITED; include `Retry-After`. |
| 502/503 | PROVIDER_UNAVAILABLE, DEPENDENCY_UNAVAILABLE; retry only using the same operation identity; a provider timeout may instead return 202 with UNKNOWN state. |
| 500 | INTERNAL_ERROR; redact internals and preserve request ID. |

Use `Idempotency-Key` UUID on booking, checkout, cancel, extension, staff mutations, refunds and payouts. Scope by actor + route + key, store canonical request hash; the same payload replays its committed response, changed payload yields 409. Different keys do not circumvent unique business-operation constraints. A duplicate still running returns 409/Retry-After or the existing 202 operation, consistently documented. Commit idempotency outcome, domain write, audit and outbox together. Expiring the seven-day response cache never removes permanent payment/refund/payout uniqueness. OTP requests use anti-abuse controls; webhooks use provider event identity. Conditional updates use `expected_version` to reject stale screens. After a timeout, fetch current state before creating any new charge/refund.

## 2. Read and identity APIs

| Method / route | Input | Output / rules |
|---|---|---|
| `POST /auth/otp/request` | `{email, intent, redirect_path?}`; allowlisted relative path | 202 generic `{challenge_id,resend_after_seconds}`; challenge is application correlation, not OTP/session. Rate-limit identity/IP/device as appropriate; no account enumeration. Provider outage returns recoverable error. |
| `POST /auth/otp/verify` | Web: `{challenge_id,email,code}` | 200 verified session using SSR provider flow, secure cookies and minimal profile. Native uses the provider SDK's OTP verification to receive/persist its session securely; API verifies resulting bearer token. Never put native refresh credentials in a web response/log. No password-reset endpoint for OTP-only release. |
| `POST /auth/sign-out` | Selected session scope | 204; revoke provider session as configured, clear web/native cached private data. Native SDK signs out and clears secure store. |
| `GET /me` | authenticated | Own safe profile, capabilities, venue memberships and terms required. |
| `PATCH /me` | safe display fields + expected_version | 200; cannot modify role, status, verified email or ownership. |
| `GET /venues` | lat/lng or manual area; radius; date/start/duration; party_size; requirement; category/amenity filters; `environment_tags` from controlled allowlist QUIET/LIVELY/OUTDOOR/SEMI_PRIVATE (reject unknown tags); cursor | 200 list + map markers, distance, indicative price/availability, venue rules summary; bounded pilot service area. Never log precise search coordinates. Invalid/unsupported area shows empty supported results, not invented venues. |
| `GET /venues/{id}` | public venue ID | 200 sanitized details, photos, capacity, rules/food permissions, amenities, map/address, hours and published review summary; unpublished returns 404. |
| `GET /venues/{id}/availability` | requested start, duration, party_size | 200 compatible physical tables and exact indicative breakdown; empty array with reason categories if none. Availability is advisory until hold. Dynamic no-store response. |
| `GET /bookings`, `GET /bookings/{id}` | authenticated owner; cursor/status filter | 200 own booking projection with separate booking/payment/refund states, current end, actions, deadline, version, rules snapshot. QR secret only on authorized confirmed/checked-in detail. |
| `GET /notifications` | authenticated owner; cursor | 200 in-app notifications; mark read through scoped mutation. |

Quote and hold checks: valid party capacity; venue published; resource active; required policies/fees/taxes configured; accepted policy hash matches; proposed 15-minute lead, 30-day horizon, 60–240-minute duration and 30-minute grid; complete range plus buffer within hours; no closure; no active claim; resource not blocked by overdue cleaning/overstay. Validate both query and hold. Device clock/countdowns are presentation only; `db_now` means `clock_timestamp()` sampled after acquiring transition locks, not stale transaction-start time.

## 3. Booking and checkout API

| Method / route | Input | Output / rules |
|---|---|---|
| `POST /quotes` | `{venue_id,resource_id,start_at,duration_minutes,party_size}` | 201 `{quote_id,expires_at,price_snapshot,policy_snapshot,policy_hash}`; authenticated, server pricing only. Proposed quote lifetime five minutes. No inventory commitment. |
| `POST /booking-holds` | `{quote_id,accepted_policy_hash,expected_quote_total_paise}` | 201 `{booking_id,public_ref,status:HOLD,hold_expires_at,version,amount_paise,currency}`. Atomic checks/claim insertion; 409 if capacity lost or price version changed. Never charge before a hold. |
| `POST /bookings/{id}/checkout` | `{expected_version}` | 202 `{payment_order_id,operation_status:ORDER_PENDING}` or 200 existing `{payment_order_id,provider_order_id,public_checkout_config,expires_at}` once ready. Persist operation before provider call; return no secret key. Native SDK/browser checkout must support chosen provider configuration. |
| `GET /payment-orders/{order_id}` | owner or scoped finance | 200 `{order_state,payment_state,booking_status,refund_status?,next_poll_after_seconds}` and safe checkout config when available. Actual provider payment attempts remain distinct records under the order. |
| `POST /payment-orders/{order_id}/verify` | callback references/signature when applicable, no client amount authority | 200 committed confirmed state, or 202 pending/unknown/refund-due with booking status. Match actual provider payment to expected stored order, currency and amount; server fetch/verification of capture is authoritative. Client success never confirms. |
| `POST /bookings/{id}/cancel-preview` | `{reason_code}` | 200 `{refund_paise,retained_paise,policy_version,preview_expires_at,booking_version}`; no mutation. Recompute at actual cancel DB time. |
| `POST /bookings/{id}/cancel` | `{reason_code,expected_version,expected_refund_paise}` | 200 cancellation + refund requested status; if cutoff changed vs preview, 409 and new amount for explicit acceptance. CANCELLED is separate from REFUNDED. Pending captured money follows same refund liability rules. |
| `POST /bookings/{id}/reviews` | `{rating,body?}` | 201 moderation-pending review only once for own COMPLETED booking. |
| `POST /support-tickets` | `{booking_id?,category,description}` | 201 ticket; verify relationship, do not expose private notes. Emergency copy routes users to appropriate local emergency channels, not a guaranteed in-app response. |

Creation example, fields shown are illustrative:

```json
{"quote_id":"uuid","accepted_policy_hash":"sha256:…","expected_quote_total_paise":12000}
```

```json
{"data":{"booking_id":"uuid","public_ref":"SS-opaque","status":"HOLD","hold_expires_at":"2026-10-26T04:35:00Z","amount_paise":12000,"currency":"INR","version":1},"request_id":"uuid"}
```

Provider order creation has its own durable operation key. If a provider call times out, store UNKNOWN and reconcile against provider references/merchant operation identity. Do not blindly create another external order/refund/transfer if the selected provider lacks a safe idempotency/retrieval capability; quarantine for an operator instead. Unique local keys alone do not prevent duplicate external side effects. A retryable failed payment may create another actual payment attempt under the same expected order, where the provider permits, only while the original hold remains valid. Record each provider payment ID separately; a failed attempt followed by success must not overwrite evidence. Any additional verified captures beyond the one allocated payment create separate refund liabilities. Captures for an expired/unconfirmed abandoned hold receive full capture refund liability; the confirmed-booking late-cancellation fee does not apply to a booking that never became confirmed.

## 4. Extension, partner and admin APIs

| Method / route | Input | Output / rules |
|---|---|---|
| `POST /bookings/{id}/extension-requests` | `{additional_minutes,expected_version}` | 201 REQUESTED with provisional incremental price, request deadline (proposed five minutes), original end and requested end. Own CHECKED_IN booking before its end; capacity, hours and max-duration checks; original booking unaffected. No availability guarantee. |
| `POST /partner/extension-requests/{id}/decision` | `{decision:APPROVE\|DECLINE,expected_version,reason?}` | 200 APPROVED/DECLINED before request_expires_at; active assigned staff/manager. Approval checks current availability but does not reserve; set approval_expires_at=decision_time+5min and notify customer. |
| `POST /extension-requests/{id}/hold` | `{accepted_price_paise,expected_version}` | 201 HELD after atomic revalidation, before approval_expires_at and original_end; 409 if another booking won. Set hold_expires_at=`min(hold_created_at+5min, original_end)`. Once held, earlier request/approval deadlines do not shorten the valid hold. |
| `POST /extension-requests/{id}/checkout` | `{expected_version}` | Same durable payment-order protocol; incremental amount only, bound to extension ID. |
| `POST /partner/bookings/{id}/check-in` | `{qr_token}` or authenticated manual lookup + secondary verification; expected_version | 200 CHECKED_IN. Proposed valid window start−15 minutes through start+15 minutes; table must be READY, booking CONFIRMED, venue assigned. Early arrival cannot occupy another guest's slot. No-show cutoff ordering enforced under locks. |
| `POST /partner/bookings/{id}/check-out` | `{expected_version,reason?}` | 200 COMPLETED and resource CLEANING; staff action/audit; retain original sold interval and cleanup buffer. Cannot be used on another venue. |
| `POST /partner/resources/{id}/ready` | `{expected_version}` | 200 READY after cleaning; reject if another booking is currently checked in. Separate from completion; no early resale. |
| `POST /partner/resources/{id}/closures` | `{start_at,end_at,reason,expected_version}` | 201 closure claim or 409 with permitted conflicting references. Venue-wide closure expands atomically over sorted resources. |
| `GET/PATCH /partner/venues/{id}` | scoped fields, expected_version | manager edits draft fields; published critical policy/rate changes create versions/review as required. Staff cannot edit rates or payout details. |
| `POST /partner/venues/{id}/staff-invitations` | `{email,role:STAFF}` | 201 invitation by owner/manager; provider invite, verified acceptance, audit; no emailed secrets in application logs. |
| `GET /partner/bookings`, `GET /partner/reports` | scoped venue/date filters | operational minimal customer data, calendar and separate finance report for owner/manager only. |
| `POST /admin/venues/{id}/review` | `{decision,reason,expected_version}` | approve/request-changes/pause by authorized admin; publish only complete eligible venue. Suspension stops new bookings and triggers assessment of future commitments. |
| `POST /admin/bookings/{id}/service-cancel` | `{reason_code,expected_version}` | reasoned partner/service cancellation, full promised refund liability, released future claim, customer alert; checked-in incidents need explicit safe recovery. |
| `POST /admin/refunds` | `{payment_id,amount_paise,reason_code,expected_version}` | 202 REQUESTED/PROCESSING, finance permission + recent MFA; reserve refundable balance atomically. Cannot exceed captured less processed/pending refunds. |
| `POST /admin/payout-batches/{id}/approve` | `{expected_version,reason}` | 202 APPROVED for reconciled available payable only; reserve allocations before external transfer. Separation of approval and worker execution; no live transfer without approved operating model. |
| `GET /admin/reconciliation`, `/admin/support-tickets`, `/admin/metrics` | capability-scoped filters | 200 redacted reports; mismatches remain visible and freeze affected payout allocations. |
| `POST /webhooks/{provider}` | raw signed body + provider event ID | 200 after signature verification and durable deduplicated event insertion. Invalid signature 400/401; database persistence failure 503 for provider retry. Never accept browser-style authentication instead of signature. |

Listing onboarding also needs scoped create/edit APIs for venues, resources, rates, policy drafts, hours, amenities and signed photo uploads; implement them using the schema field allowlists and publication gate. No endpoint exposes provider account credentials. Provider-hosted payout onboarding returns an expiring authorized link; only verified provider account references return to the backend. Sensitive provider setup and role grants require recent MFA, audit and explicit capabilities.

The remaining command surface is explicit below. All writes use idempotency, role checks and expected versions where an existing entity is changed; normal creation returns 201, successful update 200, asynchronous work 202, validation 422 and stale/conflicting state 409.

| Method / route | Input and authorized actor | Result / safeguards |
|---|---|---|
| `POST /privacy-requests` | own `{kind:EXPORT\|DELETE}` + recent OTP/session verification | 202 request ID/status. DELETE blocks new bookings, queues review of active commitments/financial retention; EXPORT creates minimal own-data package. Request acceptance is not immediate erasure. |
| `GET /privacy-requests/{id}` | own authenticated ID | 200 status and short-lived ownership-bound export download when fulfilled; never share a permanent public link. |
| `POST /partner/applications` | signed-in proposed owner; `{partner_legal_name,venue_name,category_code,address,lat,lng}` | 201 pending partner + draft venue + scoped owner membership; application_id is venue ID. No publication or payment capability implied. |
| `POST /partner/venues/{id}/submit` | scoped owner/manager, expected_version | 202 PENDING_REVIEW after required profile/media/rules/inventory/rates/hours and provider eligibility fields validate. Admin review approves or requests changes. |
| `POST /partner/venues/{id}/media-upload` | manager; `{mime_type,size_bytes,alt_text}` | 201 short-lived upload target + media ID; file remains private/pending until content/rights checks and approval. No SVG/HTML execution. |
| `POST /partner/venues/{id}/resources` | manager; `{label,kind:TABLE,capacity}` | 201 exclusive resource; kind validation prevents unsupported nested capacity. |
| `PATCH /partner/resources/{id}` | manager; `{label?,capacity?,expected_version}` | 200 only after checking future commitments; cannot reduce capacity beneath booked party sizes or bypass closures. |
| `POST /partner/resources/{id}/pause` | manager; `{reason,expected_version}` | 200 PAUSED under venue/resource locks; immediately rejects new holds, preserves existing holds/bookings for explicit recovery. This can precede a conflicting closure request. |
| `POST /partner/resources/{id}/resume` | manager; `{expected_version}` | 200 ACTIVE after eligibility/readiness/closure checks; does not delete claims. |
| `POST /partner/resources/{id}/retire` | owner; `{reason,expected_version}` | 200 RETIRED only without unresolved future holds/bookings; no historical deletion. |
| `POST /partner/resources/{id}/rates` | manager; `{hourly_paise,currency,fee_config_version,effective_from,effective_to?}` | 201 immutable rate version; no intersecting effective range. Quotes use rate effective at requested service start; existing paid snapshots never reprice. |
| `POST /partner/venues/{id}/policies` | manager; complete policy draft fields from schema | 201 new draft/version; validate food permissions, refund wording, duration/buffer rules; no overwrite of accepted snapshots. |
| `POST /partner/venues/{id}/policies/{policy_id}/publish` | manager + required platform review, expected_version | 200 published immutable policy/active pointer after eligibility; new quotes only. Critical legal/food-policy changes can require listing review. |
| `PUT /partner/venues/{id}/hours` | manager; `{periods:[weekday,opens_local,closes_local,closes_next_day],expected_version}` | 200 new active schedule version; reject changes incompatible with active claims, or pause/resolution workflow. Atomic all-period replacement. |
| `PUT /partner/venues/{id}/amenities-and-tags` | manager; `{amenities,tags,expected_version}` | 200 controlled allowlisted catalogue; verified accessibility fields require verification authority. |
| `DELETE /partner/venues/{id}/staff/{user_id}` | owner/manager; expected_version | 200 revoked STAFF membership; cannot remove final owner or elevate grants; audit, invalidate capability caches. |
| `POST /partner/payout-onboarding` | owner + recent MFA | 201 authorized expiring provider-hosted onboarding link, contingent on provider eligibility; application never handles raw account credentials. |
| `POST /partner/bookings/{id}/no-show` | assigned staff after grace; expected_version | 200 NO_SHOW if still CONFIRMED and arrival not recorded; worker only flags missed arrival for staff confirmation. |
| `PATCH /admin/support-tickets/{id}` | authorized assigned support; `{status,priority?,assigned_admin_id?,customer_visible_resolution?,expected_version}` | 200 scoped triage/resolution with audit; financial remedy calls separate finance endpoint. Sensitive incidents require additional capability. |
| `POST /admin/fee-configurations` | finance + recent MFA; approved-schema fee/tax/rounding draft | 201 draft config version; no live defaults inferred from source documents. |
| `POST /admin/fee-configurations/{id}/approve` | authorized finance approver; expected_version/reason | 200 immutable approved effective version; no retroactive edits, record approval and input evidence. |
| `GET /admin/reports/bookings`, `/admin/reports/finance` | support-safe or finance-scoped actor; bounded dates/venue, format JSON/CSV | 200 report with definitions/timezone and reconciliation state; audit personal-data export, protect CSV formula injection, deny staff payout exports. |
| `GET /partner/reports/payouts` | venue owner/manager; bounded dates | 200 partner-only gross, allocations, refund/fee adjustments, reserved amounts and evidenced payout status; unresolved totals visibly flagged. |
| `GET /admin/metrics` | authorized admin; dates/venue | 200 PRD-defined conversion, occupancy, repeat, reliability and finance metrics; do not present unknown/unreconciled amounts as earned revenue. |
| `POST /notifications/{id}/read` | own notification | 200 idempotently recorded read_at; cannot change delivery status. |
| `GET /me/notification-preferences`, `PUT /me/notification-preferences` | authenticated owner; body `{email_copies, marketing}` | 200 own choices (defaults when never saved). Affects only optional email copies; essential messages and the inbox are never switched off. Added 16 Nov 2026. |

Resource availability is not a generic DELETE endpoint: historical inventory stays referentially intact. Policy/rate/hour mutations and pause/resume acquire the same venue/resource lock path as holds, so a configuration change cannot race a reservation into an invalid state.

## 5. Booking and turnover transitions

| From → to | Trigger and atomic conditions | Side effects |
|---|---|---|
| selection → HOLD | validated quote, accepted policy, no overlap; insert booking + active claim | five-minute expiry; no confirmation notification. Selection is a client draft, not a persistent booking status. |
| HOLD → PENDING_PAYMENT | durable expected payment order initialized before deadline | provider operation; inventory remains held with same original deadline. |
| HOLD/PENDING_PAYMENT → CONFIRMED | authoritative exact capture, hold still active and `db_now < hold_expires_at` inside lock | allocate one capture, immutable balanced journal, QR hash, confirmation outbox. No deadline extension on payment start. |
| HOLD/PENDING_PAYMENT → EXPIRED | DB deadline reached | release claim, cancel/void pending authorization if supported, any captured funds refund-due. |
| HOLD/PENDING_PAYMENT → CANCELLED | customer abandons explicitly or valid service cancellation | release claim, reconcile any pending payment; do not assume a gateway window closing means failure. |
| CONFIRMED → CHECKED_IN | assigned staff verifies customer, check-in window, table ready | record staff/time; resource OCCUPIED. |
| CONFIRMED → NO_SHOW | staff confirms missed arrival after grace, no check-in, under same locks; worker flags for review only | no-show policy; retain sold interval; notify customer. Late check-in rejected or explicit audited service recovery without overlap. |
| CONFIRMED → CANCELLED | accepted policy preview matches cancellation-time arithmetic, or service cancellation | release future reservation; reserve refund if applicable and notify. |
| CHECKED_IN → COMPLETED | staff verifies departure | resource CLEANING, revoke arrival token, record actual departure; review eligibility, subject financial recognition to policy/reconciliation. |
| NO_SHOW → terminal | scheduled interval ends | retained paid slot ends naturally; reconcile financial outcome; NO_SHOW remains historically accurate. |

Cancellation after check-in is a support/finance remedy, not a normal customer cancellation transition; state remains physically accurate until staff resolves departure. The worker sends end reminders and flags overstay but never pretends an occupied table is vacant. At end+buffer, unresolved occupancy/cleaning pauses new sales for that resource and alerts staff; existing future customers need service recovery if readiness fails. Resource readiness cannot alter a paid booking interval, undo a closure or bypass overlap constraints. Completed booking and `READY` are distinct states.

## 6. Extension transitions

REQUESTED → APPROVED/DECLINED/EXPIRED; APPROVED → HELD/EXPIRED; HELD → PENDING_PAYMENT/APPLIED/EXPIRED/CANCELLED; PENDING_PAYMENT → APPLIED/EXPIRED/CANCELLED. Staff decision must occur within five minutes of request; approval gives five minutes from decision to start a hold; a valid hold gets up to five minutes from its creation, capped only by the original booking end. Approval/request expiry does not expire an already-held extension. Only a verified timely incremental capture applies it. Approval can be superseded by a competing reservation before the hold; UI says “Approved — confirm availability and pay.”

When HELD, widen the same booking claim from `[start, committed_end+buffer)` to `[start, requested_end+buffer)` under venue/resource/booking locks and exclusion constraint. Record original end and base version. On APPLIED, update booking end, aggregate immutable price allocation and event history in the same transaction; keep widened claim. On expiry/failure/cancel, shrink it to the current committed end plus buffer, preserving the original booking. A late incremental capture sets its payment allocation REFUND_DUE and reserves its full amount; the extension remains EXPIRED/CANCELLED and the original booking end stays unchanged. A concurrent checkout/cancel/extension event uses expected version and the same locks, so only a legal resulting state commits.

## 7. Payments, refunds and payouts have independent truth

Payment order: CREATED → ORDER_PENDING → READY, with UNKNOWN for uncertain external creation and EXPIRED when its hold can no longer be used. Actual payment attempt under an order: PENDING → AUTHORIZED → CAPTURED; definitive provider failure → FAILED; uncertain result → UNKNOWN → verified authoritative state. Preserve observations append-only. A delayed FAILED event cannot regress CAPTURED. A failure followed by a new authoritative late capture is recorded as captured money requiring allocation/refund, not ignored because the earlier UI said failed. Different provider payment IDs remain different attempts even under one order. Booking CONFIRMED requires its specific allocated captured payment and valid claim; CAPTURED alone is not a booking state.

Refund: REQUESTED → PROCESSING → PROCESSED; definitive failure → FAILED; timeout → UNKNOWN until reconciled. Pending/unknown amounts remain reserved. Retry with the same external operation identity and same body. Razorpay documents a dedicated refund-idempotency header; adapter implementation must follow the selected current API rather than assuming every endpoint shares it. [Razorpay idempotent refund reference](https://github.com/razorpay/markdown-docs/blob/master/api/refunds/normal-refunds-idempotent.md).

Payout: DRAFT → APPROVED → PROCESSING → PAID; definitive failure → FAILED; uncertainty → UNKNOWN. Available payable equals posted eligible partner liability less reserved refunds, disputes, holds and other pending payouts according to the approved accounting policy. Recheck under partner-account lock before approval/execution. A refund arriving after a payout was sent creates an evidenced adjustment/receivable and operations case; do not rewrite a past PAID payout. Never promise automatically supported split settlements; gateway product and account eligibility are launch gates.

## 8. Deterministic race and recovery requirements

| Scenario | Required outcome |
|---|---|
| Two holds for same table/time | one committed active claim; loser 409; no charges attempted for loser. |
| Hold expires while capture webhook waits | DB time and locks decide once; if expiry wins, booking EXPIRED, capture refund-due, replacement booking undisturbed. Even a provider capture timestamp before expiry does not resurrect a released hold under the strict proposed cutoff. |
| Duplicate/out-of-order events | event-ID dedupe plus business-key uniqueness; no duplicate ledger/notification/refund; query provider when evidence conflicts. |
| Provider capture succeeds, local commit fails | event/reconciliation reprocesses; if deadline passed meanwhile, refund-due. Never infer no charge from failed local HTTP response. |
| Refund succeeds, response lost | UNKNOWN reserved liability; reconcile same provider operation before retry; one processed refund. |
| Extension competes with next booking/closure | lock+constraint allow one compatible claim; original booking survives failed extension. |
| Customer cancellation vs capture | one locked terminal booking outcome; capture after cancellation creates refund per promised policy, never confirmation. |
| Venue closure vs hold | venue/resource locking serializes; no closure writes over an active claim; use service-cancel recovery. |
| Staff check-in vs staff no-show confirmation | same locks and DB grace cutoff; one transition, audit both attempt outcomes; worker alerts alone cannot declare no-show. |
| Worker crashes after external operation | lease expires, retry handler reconciles operation key/provider reference; no blind duplicate charge/refund/payout. |
| Payout allocation vs new refund | account/payment locks reserve liabilities before available balance calculation; disputed/unknown money stays excluded. |
| App killed/offline/payment redirect lost | next launch fetches own booking/payment state; countdown does not recreate hold or call confirmation; pending/help remains visible. |

Outbox delivery is at least once: handlers are idempotent, lease-aware and observable. Webhook `2xx` acknowledges durable ingestion, not completed downstream business work. Reconciliation detects missing webhooks using provider APIs and daily financial evidence. Razorpay explicitly documents duplicate delivery and potentially unordered webhooks; test both rather than relying on arrival order. [Official webhook practices](https://razorpay.com/docs/webhooks/best-practices/). Provider calls must be tested in selected test-mode accounts; no payment, refund, native SDK or settlement test is claimed as run by this planning kit.
