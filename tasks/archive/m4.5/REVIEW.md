# Review checkpoint - M4.5 support and reviews

Independent review: **NOT performed** (self-review only). Include confidential-ticket access in the M4 review.

| Area | Checked | Evidence |
| --- | --- | --- |
| Review eligibility | Own COMPLETED booking only, once; others NOT_FOUND | integration |
| Moderation | Support/superadmin + TOTP; hide needs reason; audited; public sees PUBLISHED only, no identities | integration + e2e |
| Ticket privacy | Reporter-only reads; private notes never in reporter projections; staff see only their own reports | integration + e2e |
| Confidential incidents | Superadmin or assigned admin only; others NOT_FOUND and counted as restricted; NULL-safe check | integration + e2e |
| Contact escalation | Reason >= 10 chars, permissioned like the ticket, audited each time | integration + e2e |
| Booking lookup | Support/finance/superadmin + TOTP; bounded; email search and detail views audited; no codes/secrets | integration |

Open: E1 support-to-customer messaging is a single reply field (no thread); E2 ticket notifications in M4.6;
E3 review text is not auto-screened (moderation is manual).
