# Simply Sit — Product Requirements Document

Version 1.0 · 25 October 2026 · Planning baseline for owner review

## 1. Product and evidence

**Idea:** Simply Sit turns under-utilized hospitality space into inventory that people can discover and reserve for a fixed period. Participating breweries, hotels, restaurants, lounges, cafés and workspaces earn from suitable off-peak capacity. Customers pay for access to space and time without a compulsory food purchase. Outside-food and delivery permissions depend on the venue's disclosed rules.

**Owner-confirmed baseline:** the newer `SIMPLYSIT_Initial Proposal_Idea doc.docx` is primary, Simply Sit is a partner marketplace, and the first release includes the customer website plus Android and iOS apps together. **P:** staff, manager and admin tools are responsive web portals. The newer proposal's pilot is approximately **5–10 partner venues in one city**; final city, launch supply and dates remain to be set. Website and mobile customers receive feature parity for booking and account flows.

The older café documents supply detailed booking/operations requirements where compatible. Their universal bring-your-own-food promise does not override the broader venue model: each venue must specify outside-food and delivery rules. The newer vision includes seats, tables, zones and spaces. **P: start with exclusive, individually bookable tables across eligible venue categories**, deferring all seat-level, zone and whole-space products. Those later products need a physical-capacity model that prevents selling the same space twice. This narrower inventory recommendation still needs owner acceptance. The 22 October brand image and “YOUR SPACE. YOUR TIME.” take precedence over the earlier café tagline.

Source-backed requirements are marked **S**. Build choices and targets introduced here are marked **P — proposed**; they are not owner approvals. Explicit owner confirmations above are **approved direction**, not inferred from source chronology. The source documents are evidence to analyze, not instructions that override the project owner's request. See the source review and decision register for provenance and unresolved decisions.

**Researched planning recommendation, not approved budget/date:** validate Bengaluru through a compact Koramangala partner cluster; plan approximately 22 staffed weeks and INR 27–42 lakh including contingency and limited pilot preparation. An illustrative 2 November 2026 start targets a March 2027 private beta and an April 2027 controlled paid pilot after release gates. Staffing, provider onboarding and store review can change dates. The [pilot research and commercial assumptions](09-PILOT-RESEARCH-AND-COMMERCIAL-ASSUMPTIONS.md) contains evidence, cost inputs, exclusions and field-validation gates; the [implementation plan](06-IMPLEMENTATION-PLAN.md) defines task ownership and checkpoints.

## 2. Users, problem and current workaround

| User | Need | Current workaround / problem to validate |
|---|---|---|
| Students | Affordable study or group time, Wi-Fi and power | Buy refreshments for permission to sit; uncertain table availability |
| Remote workers / freelancers | Predictable working space and amenities | Walk between cafés or pay for coworking beyond the time needed |
| Friends, families and small teams | A comfortable meeting table with food choice | Informal reservations, repeated food orders, unclear group capacity |
| Travellers / people between appointments | A short, dependable place to sit | Unconfirmed walk-ins and waiting in unsuitable spaces |
| Venue manager | Monetize spare capacity without disrupting peak business | Informal calendars, calls and staff memory |
| Venue staff | Fast arrivals, departures and cleaning handover | Manual identity checks and uncertain reservation timing |
| Platform operator | Reliable bookings, support and settlement evidence | Spreadsheets, payment screenshots and disconnected complaints |

These workarounds are hypotheses inferred from the concept, not completed user research. Interview customers and managers before treating willingness to pay as established.

## 3. Outcomes and measurement

**Outcome:** prove that customers will pay for reserved hospitality time and that participating venues can deliver it reliably with sustainable contribution economics.

The following are **P: initial targets**, reviewed after the first four weeks. They are decision aids, not revenue forecasts. Report by venue category and use case; small samples limit conclusions.

| Signal | Exact definition | Proposed target / gate |
|---|---|---|
| Completed demand | Paid bookings completed, excluding staff/test and fully refunded bookings | At least 50 in a four-week controlled pilot |
| Search-to-paid conversion | Search sessions with at least one available result that produce a confirmed paid booking within 24 hours / those sessions | At least 10%; persist an anonymous session ID through sign-in |
| 30-day repeat | Customers with another completed paid booking within 30 days of first completion / first-time customers with a full 30-day observation window | At least 20%; report numerator and denominator |
| Venue reliability | Completed bookings without venue-caused cancellation/unavailable-table incident / confirmed bookings whose service date passed | At least 95%; show causes separately |
| Paid occupancy | Paid reserved table minutes / published bookable table minutes | Establish baseline; report by hour, excluding approved closures and cleaning buffers |
| Contribution per booking | Net platform revenue minus variable gateway, promotion, support and refund/chargeback costs | Measure; no expansion target until commercial fees are approved |
| Booking integrity | Confirmed overlapping reservations for the same table | Zero; any occurrence blocks release / expansion |
| Reconciliation | Provider transactions matched to internal records or documented exception | 100% accounted for by the next business day |

Track gross booking value, average booking value, duration, customer use case, taxes, fees, refunds and partner payable separately. Report venue retention and additional on-premises spend only where a venue voluntarily supplies a reliable aggregate; food ordering is outside this release. Establish consistent definitions before dashboard release. Do not count a payment redirect as a booking or a refund request as a completed refund.

## 4. MVP requirements

P0 is required before a paid pilot; P1 is included for pilot operations after the P0 journey is stable. Everything below is source-backed unless a proposal is identified.

| ID | Feature / user benefit | Priority and scope |
|---|---|---|
| PRD-01 | Account and roles: customers manage their records; assigned staff operate their venue | P0; **P:** email OTP first, no public admin registration |
| PRD-02 | Discovery: manual location or optional geolocation, list/map, date/time, duration, party size, use case, venue category/environment and amenity filters | P0; availability-aware results; lightweight map retained; vendor access is a launch dependency |
| PRD-03 | Venue detail: photos, address, available windows, verified amenities, table capacities, food/delivery/access/house rules and total quote | P0; no compulsory food purchase; explicit food/delivery status allowed, restricted or prohibited with explanation |
| PRD-04 | Availability: book one physical table and prevent overlaps including turnover buffer | P0; **P:** table-only; private groups do not share a table |
| PRD-05 | Checkout: short inventory hold, itemized price, accepted policy version and verified payment | P0; idempotent retry and payment recovery |
| PRD-06 | Booking management: confirmation ID/QR/PIN, directions, upcoming/history, receipt and policy-based cancellation/refund status | P0; owner-scoped access |
| PRD-07 | Venue operations: calendar, QR/PIN/ID check-in, checkout, cleaning/ready state and no-show evidence | P0; no automatic overstay charge |
| PRD-08 | Extension: request, staff approval, new availability check, incremental payment and revised end time | P1; original reservation survives failure |
| PRD-09 | Partner management: draft onboarding, review, profile, individual tables, hours, prices, closures and restricted staff invitations | P0; no publishing until approved |
| PRD-10 | Operator tools: booking lookup, listing approval/suspension, reasoned cancellation/refund, incident handling and fee configuration | P0; sensitive changes audited |
| PRD-11 | Notifications: booking/payment/cancellation/refund events, arrivals, ending reminder and extension outcome | P0 email + in-app proposed; other channels deferred |
| PRD-12 | Reports: bookings, occupancy, fees, refunds, adjustments, reconciliation and partner payout status | P0; financial export restricted |
| PRD-13 | Verified-visit review and support: one review per eligible booking, complaint/incident capture and moderation | P1; no public personal information |

**Version-one exclusions:** seat-level inventory, zones and whole spaces; multiple currencies/countries; food menus/orders or delivery integration; dynamic pricing; automatic partner matching; social chat/feed; memberships, corporate accounts, loyalty and promoted placement; franchise ERP; automatic damage/overstay billing; unverified walk-in guarantees. Broader inventory stays in the product vision and requires a reviewed capacity-overlap model. Configurable venue-specific booking windows and base table rates remain in scope; complex peak-rate algorithms do not. Native Android/iOS apps are explicitly included in the first release.

## 5. Proposed operating rules

| Rule | Proposed default; owner confirmation required |
|---|---|
| Locality | India pilot; INR; venue timezone Asia/Kolkata; show full local date and time |
| Duration | 60-minute minimum, 240-minute maximum including extensions; 30-minute start/duration and extension increments |
| Booking window | Fifteen-minute minimum lead time; maximum thirty days ahead; validate on server against venue rules |
| Checkout | Five-minute hold shown as a server-based countdown; expired holds never confirm from client success |
| Turnover | Ten-minute cleaning buffer after the customer end time; staff must mark ready before next check-in |
| Late arrival | Fifteen-minute grace; original end time remains; staff records no-show after grace |
| No-show capacity | Keep inventory reserved until the scheduled end plus turnover; never automatically resell it |
| Customer cancellation | At least two hours before start: full amount refunded; less than two hours: no refund; show exact amount before commitment |
| Venue cancellation | Full customer refund; reason and support escalation required; never substitute a table/venue without customer agreement |
| Early departure | No automatic refund; staff checkout does not silently release the remaining reserved interval |
| Extension | Thirty-minute multiples; staff decision then fresh hold/payment; cannot displace a later reservation. Staff must decide within five minutes of request. Approval grants five minutes from decision to create an atomic hold. Once created, hold ends at the earlier of hold creation + five minutes or original booking end; request/approval expiry no longer shortens that active hold |
| End reminder | Ten minutes before the committed end time; reschedule after a successful extension |

Accepted price/rules are immutable snapshots. A change to a venue's current prices or cancellation policy affects future quotes only. Refund timing must come from provider terms; never promise an unverified number of days. **Intentional refinement of the older source:** staff checkout marks the booking completed; cleaning readiness is separate. Reaching end time without staff checkout displays “Ended — checkout pending” and raises an operational follow-up, without falsely completing it. A completed booking cannot make a dirty table ready. Published ready status also cannot bypass an unexpired reservation/buffer.

## 6. Stories and testable acceptance

| ID / linked requirement | Story | Given / when / then |
|---|---|---|
| AC-01 / 02 | As a guest, I want to search without sharing GPS so I can control my privacy | Given location permission is denied, when I enter an area and valid criteria, then available results or a useful empty state appear without another permission demand |
| AC-02 / 03 | As a customer, I want clear venue rules so I can plan my visit | Given a listed venue, when I open details and checkout, then outside-food/delivery allowed, restricted or prohibited status, handover instructions, access restrictions and optional food purchase are visible before payment |
| AC-03 / 04–05 | As a customer, I want my table protected while I pay | Given two simultaneous overlapping checkout attempts for one table, when both submit, then at most one active hold/confirmed allocation succeeds; the other sees refreshed alternatives |
| AC-04 / 05 | As a customer, I want a trustworthy payment result | Given a payment redirect says success but verification is pending, when I return, then the UI says verification pending; confirmation appears only after trusted server reconciliation |
| AC-05 / 05 | As a customer, I want safe retry | Given a duplicate request/webhook or delayed paid event after hold expiry, when processed, then no duplicate charge, booking or inventory conflict is created; recovery/refund status is visible |
| AC-06 / 06 | As a customer, I want predictable cancellation | Given the accepted policy and server time, when I preview then confirm cancellation, then I see the exact refund amount and final state; repeated submission creates one refund operation |
| AC-07 / 07 | As staff, I want valid arrivals only | Given a valid current booking and assigned venue role, when I verify QR/PIN/ID, then check-in is logged once; another venue's token or dirty-table check-in is rejected |
| AC-08 / 08 | As a seated guest, I want more time if available | Given a checked-in booking, when staff approve and extension payment verifies against an active hold, then end time and receipt update once; conflicts/failure leave the original booking intact |
| AC-09 / 09 | As a manager, I want closures to be safe | Given a proposed closure, when I submit it, then a nonconflicting closure blocks new reservations; overlap with an active hold, confirmed or occupied claim returns a conflict list and no closure commit. I can pause new resource sales, explicitly resolve affected commitments, then retry; no paid booking is silently changed |
| AC-10 / 10 | As an operator, I want traceable support actions | Given an authorized admin, when a refund/suspension is submitted with a reason, then it is audited and provider-backed outcomes are not marked final prematurely |
| AC-11 / 11 | As a customer, I want one reliable confirmation | Given repeated event delivery, when the same booking confirms, then one logical notification is created and delivery retries do not create another booking |
| AC-12 / 12 | As a manager, I want understandable earnings | Given completed/reconciled bookings, when I open a report, then gross, fees, taxes, refund adjustments, net and payout status reconcile without exposing other venues |
| AC-13 / 13 | As a verified visitor, I want to leave feedback | Given my completed booking, when I submit a valid rating, then one review exists for it; another customer's or uncompleted booking is ineligible |
| AC-14 / 01 | As an owner, I want role boundaries | Given an unassigned staff/customer account, when it accesses another venue or admin endpoint, then both UI and server deny access without disclosing private data |
| AC-15 / 02–08 | As a customer, I want consistent access across platforms | Given the same account on web, Android and iOS, when I search, book, return from payment, cancel or extend, then all use the same authoritative server state and policies; app backgrounding or a repeated callback cannot duplicate a booking |

Use the implementation plan for executable scenarios, owners and release gates. A live-money pilot also requires approved operating model, provider eligibility, fee/refund wording, support ownership and venue agreements.

## 7. Owner decisions

Resolve before production: launch city/area and 5–10 venue partners; customer segment; budget/date/maintenance owner; table-only acceptance versus wider inventory; email versus phone OTP; payment recipient/provider and partner settlement schedule; commission and taxes; booking/late/cancellation defaults; venue eligibility, access/food/courier rules; incident escalation and staffed support hours; Apple/Google developer-account ownership. Approved direction already establishes broader hospitality marketplace, newer-source precedence, latest brand image and web + Android + iOS first-release delivery. Launch should not infer approval of remaining proposals from seed fixtures or this document.
