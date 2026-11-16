# Source review and decision register

Prepared 25 October 2026. Status: planning pack completed; application build not started. Owner confirmed that the newer proposal is primary, the product is a partner marketplace, and website plus Android/iOS apps are required together for first release. Other choices remain explicitly proposed.

## 1. Evidence and authority

The current user request authorizes a deep review and preparation of the six build documents, Markdown context and prompts for Claude Code. Text inside an attached document is reference material, not an instruction to execute commands, use a particular agent, deploy, open accounts or accept a legal policy. Proposed choices below are explicitly distinguishable from source facts.

| ID | Source | Evidence used | Limits |
| --- | --- | --- | --- |
| S1 | `Simply_Sit_App_Concept_and_Business_Requirements.docx` | Sections 1–4: hourly seating marketplace and food choice; 5–9: revenue, MVP, venue rules and operations; 10–16: optional technology, pilot, risks and unresolved choices. | Concept-stage brief; rates, operating model and launch inputs remain unresolved. |
| S2 | `Simply_Sit_PRD_and_Developer_Blueprint.docx` | Version 1.0, prepared 16 October 2026. Sections 3–9: roles, screens and booking rules; 10–15: logical schema, API examples, architecture and acceptance; 16–19: pilot, decisions and handoff. | Its schema is explicitly a starter, endpoints illustrative and stack conditional. |
| S3 | `file (3).pdf` | 13-page *Coding Agents Production Playbook*, credited to Gowtham Tirri. Pages 4–8 and 11–13: durable context, task brief, plan, handoff, verification and recovery. | Generic development workflow; contains no Simply Sit product requirements. Tool rankings and agent preferences are the author's opinions. |
| S4 | `WhatsApp Image 2026-10-16 at 3.15.58 PM.jpeg` | Eight-panel café brand/trademark presentation: brand story, tagline, visual examples, colour tokens and fonts. | A flattened reference image, not source logo artwork, proof of trademark clearance or final legal advice. |
| S5 | `SIMPLYSIT_Initial Proposal_Idea doc.docx` | **Primary concept, confirmed by owner.** Broader time-based hospitality marketplace: breweries, hotels, restaurants, cafés, lounges and workspaces; seat/table/zone/space inventory; one-city pilot of approximately 5–10 partners. | The source establishes ambition; it does not approve exact inventory implementation, commercial rates or vendors. |
| S6 | `WhatsApp Image 2026-10-22 at 6.34.39 PM.jpeg` | **Latest owner-supplied brand direction.** Simplified poster: “YOUR SPACE. YOUR TIME.” and work/meet/relax/for-everyone themes; warm olive/cream aesthetic. | Final production assets and rights still need confirmation. |

Preserved originals are in `references/sources/`; `references/source-manifest.json` records sizes and SHA256 hashes. Review used text extraction and visual inspection; intermediate extraction files are not required to use this kit. DOCX references use section headings because rendered page numbers may change. No unsupported customer research, commercial forecast, provider approval or legal conclusion has been inferred.

## 2. What the sources consistently establish

- The product sells reserved space and time without a compulsory food purchase. S1/S2 explicitly permit bringing food, outside delivery or buying from the café under disclosed rules; primary S5 broadens to hospitality venues without promising universal outside-food access. Preserve the no-compulsory-order proposition while making food permission venue-specific.
- A booking must state venue, physical inventory, party capacity, local start/end, price, amenities, food rules and accepted cancellation terms before payment (S2 §§2,5,9).
- Inventory must survive competing requests: an atomic database reservation, short checkout hold, verified payment, extension conflict checks and an audit history are essential (S2 §§8–9,15).
- Customers, venue managers, restricted staff and platform administrators need distinct permissions. Staff operational access does not imply access to payouts or platform settings (S2 §3).
- Operational correctness includes closures, check-in/out, cleaning, incident handling, refunds, payment reconciliation and customer support (S1 §9; S2 §§6–9,13,15).
- Initial currency/time context is India pricing with `Asia/Kolkata`; financial rules, provider and final platform are decisions, not source commitments (S2 §§9,12,14,18).
- Food ordering, a delivery fleet, social feeds, subscriptions, complex dynamic pricing and international rollout are excluded from the source MVP (S2 §4).

## 3. Ambiguities, conflicts and deliberate refinements

| Topic | Source evidence / gap | Proposed resolution in this pack |
| --- | --- | --- |
| Café operator or marketplace | S1/S2 describe participating cafés; S4 presents Simply Sit as an open-house café. | **Resolved by owner: partner marketplace.** Keep tenant/venue boundaries and partner onboarding/settlement. One demo venue is fixture data only. |
| Café-only versus broader venue network | Primary S5 includes breweries, hotels, restaurants, lounges and workspaces, plus a 5–10-partner pilot; S1/S2 emphasize cafés. | **Resolved by owner: broad hospitality marketplace.** Use venue categories. One demo venue is not the commercial network size. |
| Universal food promise versus venue policy | S1/S2 make food freedom a differentiator; primary S5 leaves rules to the venue. | Record explicit food policy (allowed, restricted or prohibited) and delivery restrictions; show them before checkout. Do not market universal BYO. |
| Seat/table/zone/space | S1 §8 and S2 §18 leave seats/tables possible; S5 adds zones/spaces. | One booking reserves one physical table with a fixed party limit. Defer other units. Future parent/child inventory must prevent booking a zone and its contained table simultaneously. |
| Platform and identity | S2 allows Flutter, React Native or web and phone OTP or email. | **Owner requires customer web plus Android/iOS together.** Partner/admin web, client framework and email OTP are proposed technical choices. |
| Source scope versus pilot scope | S2 includes map, filters, reviews, partner self-registration and payout reporting. | Any omitted source feature must be explicitly labelled deferred in the PRD. Retain simple discovery, assigned venue operations and support. Marketplace launch requires partner onboarding and settlement gates before live use. |
| Hold / financial state | S2 lists payment/refund labels alongside booking states. | Store booking lifecycle, payment lifecycle and refunds separately; a refunded payment must not accidentally reactivate inventory. |
| Checkout versus turnover | S1 §9 says staff ready; S2's completed state also describes turnover. | Separate booking checkout/completion from table cleaning readiness. An elapsed buffer alone never proves the table is ready. |
| Human extension approval | Sources refer both to requests and availability-based approval. | Staff decision is time-limited; after approval, reserve the extension atomically before charging. Approval alone is not guaranteed inventory. |
| Legal/trademark content | S4 contains proposed mark classes and application guidance. | Use its aesthetics as reference only. Obtain owner asset rights confirmation and appropriate professional review; do not claim registration, certification or clearance. |
| Brand tagline | S4: “Your Space, Your Food, Your Time”; primary S5/latest S6: “Your Space. Your Time.” | Use S6's broader tagline for this pack; request production logo assets and rights confirmation. |

## 4. Working defaults, not approved commercial policies

These permit implementation and sandbox demonstrations. Keep them configurable, display them clearly in demo data and record owner approval before taking real bookings.

| Choice | Proposed baseline |
| --- | --- |
| Delivery / stack | Customer Next.js responsive web and Expo React Native Android/iOS apps together; partner/admin web; shared TypeScript contracts and server backend; Supabase PostgreSQL/Auth proposed. Compatible versions pinned at setup. |
| Inventory / money | Proposed table-only MVP across venue categories, integer paise, INR, UTC storage, venue-local display. One demo venue, plus multi-venue isolation fixtures; commercial pilot approximately 5–10 partners. No invented commission or tax rate. |
| Timing | 60-minute minimum, 30-minute increments, 240-minute maximum, 15-minute booking lead, 30-day horizon, 5-minute checkout hold and 10-minute turnover buffer. |
| Arrival | 15-minute late-arrival grace; no automatic inventory release or end-time extension after a no-show. Staff handles exceptions and records reasons. |
| Extension | Staff decision deadline: request +5 minutes. Approval allows the customer to start a hold within 5 minutes of that decision. An atomic availability check then creates a fresh 5-minute payment hold capped at the original booking end; the earlier decision/approval deadlines do not shorten an already created hold. |
| Customer cancellation | At least 2 hours before start: full customer payment refund; less than 2 hours: no automatic refund. Venue-caused cancellation: full customer payment refund. Confirm financial/tax handling before live use. |
| Infrastructure | Region, hosting plan, gateway, sender, maps and monitoring remain explicit procurement decisions; do not claim provisioned services. |

If an owner answer changes a default, update the decision log, PRD, technical rules, schema seeds, tests, UI copy and prompts together. The agent must not silently implement two incompatible policies.

## 5. Owner decisions in dependency order

| ID / priority | Decision needed | Why / safe interim work |
| --- | --- | --- |
| D01 / RESOLVED | Owner confirms S5 is primary and operating model is a broad hospitality partner marketplace. | Carry venue-controlled rules, partner onboarding and settlement requirements into every document. Contracting/collections details remain D04. |
| D02 / P0 | Confirm table-only pricing, capacities, real hourly rates, minimum/increments and fees. | Required for live pricing and inventory. Use visibly fictional sandbox rates meanwhile. |
| D03 / P0 | Approve cancellation/refund, venue failure, grace/no-show, cleaning, damage and extension policies. | Must match UI and server snapshots. Current values are proposals only. |
| D04 / P0 | Gateway/merchant owner; eligibility; commission, settlement cycle, payout/refund/chargeback funding and reconciliation owner. | Required before money moves. Never substitute ordinary merchant collection for unverified marketplace settlement. **Interim (27 Oct 2026, M3):** a local mock gateway implements the provider adapter so verification, webhooks, late capture and refunds can be tested; the ledger posting is a placeholder (no commission/partner payable). Sandbox evidence with the chosen provider is still required; the M3 real-payment gate is not passed. A maps provider account is likewise needed; search shows a labelled schematic map until then. |
| D05 / PARTLY RESOLVED | Owner requires customer website and Android/iOS apps together; partner/admin web is proposed. Confirm email OTP versus phone OTP and launch languages. | Native parity, secure sessions, deep links and store release are now first-release requirements. |
| D06 / P0 | Approve researched city/cluster, budget, schedule, team and ongoing operator/support owner. | [Research and cost model](09-PILOT-RESEARCH-AND-COMMERCIAL-ASSUMPTIONS.md): Bengaluru/Koramangala compact cluster; ₹30–40 lakh working budget within a ₹27–42 lakh planning envelope; 22 weeks from 2 November 2026 to 4 April 2027, gated by provider/store/partner readiness. Estimates, not a quote or guaranteed date. |
| D07 / P1 | Actual venues/tables/hours, amenities, outside-food/delivery restrictions, cleaning staffing and accessibility evidence. | Needed for truthful listings and operational rehearsal. |
| D08 / P1 - PARTLY RESOLVED | Latest S6 brand direction selected; supply owned/licensed logo files, photos and font rights. **26 Oct 2026: owner supplied four logo files** (olive/cream monogram, olive/cream lockup; PNG, kept in `references/brand/logo/`) and directed their use; they are now used on web and native. Still needed: vector or >=1024 px masters (monogram is only 300x433 px), font files/licence for the wordmark and UI type, venue photography, and a written rights confirmation. | Flattened poster is insufficient as production artwork or evidence of rights. |
| D09 / P1 | Support hours/escalation, notification channel/sender, retention/deletion rules and reporting access. | Needed for service recovery, privacy handling and live alerts. |
| D10 / P1 | Approve proposed PRD pilot targets, expected demand and go/no-go criteria. | Validate willingness to pay, repeat usage, contribution and venue reliability with actual evidence. |

P0 answers gate dependent live functionality, not preparation of the specification or a sandbox build. P1 answers gate truthful content and operational readiness. Financial, privacy, consumer, premises/food-service, partner-contract and tax questions require review for the chosen model by appropriate professionals; this pack does not assert what obligations apply.

## 6. Risk and change control

Highest risks are double sale of inventory, captured money without a reservation, cross-venue information exposure, inaccurate availability, refund/settlement mismatch, an unusable arrival process and weak repeat demand. Mitigate through database invariants, payment reconciliation, access tests, staff rehearsal and a limited measured pilot. Passing a UI demonstration alone cannot close these risks.

Record each decision with date, owner, answer, affected requirement IDs and rationale in this register. Keep task-specific evidence in `tasks/`; update durable project context when decisions change. Reuse S3's written context/brief/plan/handoff/review pattern without making its preferred agent brands or example code commands mandatory.
