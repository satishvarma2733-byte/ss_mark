# Review checkpoint - M4.3 partner operations

Independent review: **NOT performed** (author self-review only; CLAUDE.md requires independent review of permission
changes before release - batch with M4.1/M4.2 money changes).

## Author self-review

| Area | Checked | Evidence |
| --- | --- | --- |
| Tenancy | Every partner function resolves the venue from the record and re-checks membership + role + aal2 inside the transaction; staff FORBIDDEN, others NOT_FOUND; customers learn nothing | integration "keeps partner and admin actions to the right people"; e2e 404 for customers |
| Role escalation | Managers invite only STAFF; owners invite MANAGER; nobody revokes themselves; last owner protected; accepting a lower invitation never downgrades | integration invitations test |
| Invitation acceptance | Matched against the verified Auth email inside the database; wrong account NOT_FOUND; expired 410; nothing secret emailed | integration + e2e |
| Inventory integrity | Hours/capacity/retire/closure go through the venue -> resource lock path and refuse with references; pause blocks new holds only | integration T12 recovery test + e2e |
| Immutability | Published policies/rates untouched; new rate versions close the open one; new quotes only | integration rate test |
| Photos | Private bucket; content sniffed; Storage policies mirror the DB rule; proxy returns 404 for others; nosniff/CSP headers | e2e pending photo 404 -> approved 200 |
| Admin actions | SUPPORT/SUPERADMIN + aal2 + reason, audited; pause cancels nothing | integration review tests |

### Found and fixed during the slice

- P1: an owner without TOTP saw "No access" for their own new draft venue (venue RLS requires aal2 for unpublished
  venues). `/me` now lists own memberships via `app.my_memberships()`; booking data stays TOTP-gated.
- P2: the TOTP step dropped the selected venue (`?venue=`); the return path now keeps it.
- P3: the inventory page lost success messages after refresh (rows keyed by version) and showed the customer-facing
  "choose another time" text above partner conflict guidance; both fixed.

### Open / accepted

- Q1 Venue-wide blackout creates one claim per table (released individually).
- Q2 Media upload records the row first, then uploads; a Storage failure withdraws the row (best effort; an orphan
  object or row is possible if the process dies in between - never publicly visible).
- Q3 `partner_staff` shows member emails to their venue's managers (needed to manage access).
- Q4 Partner-set policy bounds are pilot proposals (increments 15/30/60, durations 30-240, etc.) pending D03.
