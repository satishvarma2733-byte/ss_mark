# Simply Sit — UI and UX Design Brief

Version 1.0 · 25 October 2026 · Proposed product interpretation of supplied branding

## 1. Audience, tone and references

Serve students, workers, groups and hospitality teams with a **warm, calm, dependable** interface. Communicate practical certainty: available space, exact time, party capacity, total payable amount and venue rules. Use “Find your space. Book your time.” and “Check the venue's food and delivery rules before you book.” Food purchase is optional; permission to bring outside food is venue-specific. Do not suggest food is included in the seating price.

The **22 October supplied brand image is authoritative**: olive, cream, natural materials, monogram, “SIMPLY SIT” wordmark and **“YOUR SPACE. YOUR TIME.”** The visual themes are Work, Meet, Relax and For Everyone. “For Everyone” is inclusive brand language, not a guarantee that every venue has no age/access restrictions. Show applicable venue restrictions explicitly.

The older 16 October trademark sheet is a secondary reference for exact color/font tokens. Its café tagline, universal BYO promise and trademark guidance do not override the newer brand/model; trademark content is not legal clearance or an application requirement. Obtain a clean authorized logo source; do not crop a poster or registration sheet into a production logo. The newer proposal covers breweries, hotels, restaurants, lounges, cafés and workspaces; use category-appropriate real photography rather than making every listing resemble a café.

The source documents cite ride-hailing as a marketplace analogy: borrow location → availability → transparent price → confirmation simplicity. Do not copy a specific product's interface, imply a commercial relationship, or add vehicle-style live tracking. Use familiar reservation calendars and clear ecommerce payment status as interaction patterns; no new external reference products are mandated.

**Owner-supplied UI/UX references (received 26 October 2026, NOT YET REVIEWED):** Figma file `https://www.figma.com/design/c0fB0IEKsjJeHjySPfTzA6/Untitled?node-id=0-1` and Google Stitch project `https://stitch.withgoogle.com/projects/3438700693845958569`. Figma link sharing is on, but only Figma's public oEmbed preview could be retrieved (the canvas blocks automated browsers and the Figma connector needs authorizing); Stitch requires a Google sign-in. The low-resolution preview is saved as `references/ui/figma-overview-thumbnail.png` and shows about 9 mobile screens (photo-led venue cards, venue detail, form/checkout, QR confirmation), about 8 desktop screens (search list + map, venue hero, partner/admin portal with a dark olive sidebar, a booking timeline and a stats dashboard) and 1 narrow screen, in olive/cream with an **orange accent that is not in the tokens below**. Text, spacing and components are not legible at that size. Until full-size exports are reviewed, the references are not authoritative and current screens follow this brief. Once reviewed, use them for screen layout and component patterns; where they conflict with the 22 October brand image, these tokens, the accessibility rules in section 5 or the venue-rule/price disclosure rules above, record the conflict and ask the owner before changing direction.

## 2. Tokens and typography

| Token | Value | Intended use |
|---|---|---|
| `brand.primary` | `#4F5A3F` | Primary buttons, links, selected navigation |
| `brand.sage` | `#A3B18A` | Soft highlights, decorative surfaces; dark text |
| `brand.sand` | `#DCCFBC` | Warm card accents / separators |
| `surface.canvas` | `#F6F4EF` | Main cream background |
| `text.primary` | `#2E2E2E` | Body text and headings |
| `surface.card` | `#FFFFFF` | Forms, calendars, content panels |
| `text.muted` | `#5F6259` proposed | Secondary copy; verify contrast on each surface |
| `status.success` | `#27623A` proposed | Success with check icon + label |
| `status.warning` | `#805400` proposed | Pending/attention with icon + text |
| `status.error` | `#A52A2A` proposed | Errors with message and corrective action |
| `focus.ring` | `#245FC4` proposed | High-contrast keyboard focus outline |

Exact brand colors and fonts above come from the older supplied sheet and are **proposed token continuity** with the authoritative newer image, which gives no explicit color/font specifications. Semantic tokens are proposals. Verify all actual foreground/background combinations. Sage and sand are decorative backgrounds, not small text colors on cream. Never encode payment/availability solely through color.

Use **Playfair Display** for page/marketing headings and **Montserrat** for body, inputs, prices and navigation. Self-host licensed font files or use an approved delivery method; system serif/sans fallbacks must remain readable. Body 16px/1.5 line height; small helper 14px minimum; headings 32/40, 24/32, 20/28; price total 24/32 semibold. Use tabular numerals for money/countdowns. Avoid all-caps paragraphs and excessive letter spacing inherited from print branding.

## 3. Layout and components

Customer website plus Android/iOS apps are confirmed for first release; partner/admin remain responsive web. Share design tokens and content hierarchy across platforms while using accessible native interaction patterns. Use safe areas, respect system text scaling, keyboard avoidance and Android system Back; provide consistent booking/payment state after app switching. Do not frame an embedded website as completed native delivery.

Use a 4px spacing unit with 8/12/16/24/32/48px increments. Suggested web breakpoints: compact under 640px, medium 640–1023px, wide 1024px+. Content max width 1200px; booking/payment forms 640px. Compact gutters 16px, desktop 24–32px. Cards 12px radius; buttons 8px; restrained shadows and visible borders. Test at 320px web width, 200% web zoom, native large text and landscape.

Wide search uses filters/list alongside map; compact search defaults to list with a separate map toggle. Partner calendars offer agenda view on small screens; do not compress desktop grids into unreadable columns. Financial tables use responsive row detail and labeled columns, with controlled horizontal scrolling only when needed.

| Component | Required behavior |
|---|---|
| Buttons | One primary action per task region; verb labels; busy/disabled reason; destructive action separated from navigation |
| Fields | Persistent visible label, example only where useful, inline error linked programmatically; retain input after error |
| Venue card | Real photo, category, venue name, availability, table price basis, capacity, distance source, explicit food-policy badge, verified amenities |
| Table/time selector | Explicit date/start/end, party size, one selected table, unavailable reasons, fresh quote after changes |
| Price summary | Base seating, fees, taxes, discounts if enabled, total INR; no hidden payable charge |
| Booking status | Plain-language label + icon + timestamp; distinguish payment pending, confirmed, refund pending and refunded |
| Hold countdown | Server-derived expiry and absolute expiry time; warning announced sparingly; expiry offers fresh availability |
| Calendar / readiness | Reservations, cleaning, blocked and ready have text/patterns as well as colors |
| Confirmation | Booking ID and accessible PIN alternative to QR, date/time/address, food rules, directions, receipt and next action |
| Alert / dialog | Specific consequence, recovery action, clear cancel; focus trapped and restored; avoid dialogs for routine browsing |
| Toast | Supplementary feedback only; booking/payment/refund results remain visible in-page |
| Upload | Type/size guidance, progress, retry/remove, alt-description field for venue photos; no sensitive evidence in public image storage |

## 4. Screen hierarchy

C01–C03 lead with area/time/use case, then relevant results; include venue category and environment without burying availability. Target pilot supply is 5–10 venues in one city, but empty and sparse results must remain honest. C04 places price/capacity and outside-food/access policy near the booking action, then amenities, photos, rules and reviews. Accessibility claims should describe verified features, not a generic “fully accessible” promise.

C05 keeps selected table, party size and exact end time visible, then provides the complete quote/rules review and explicit acceptance before hold creation. C06 repeats the total, cancellation consequence, accepted rules and hold expiry before Pay. Changed price/rules require renewed acceptance. C07 uses explicit “Verifying payment” and a persistent support reference during ambiguity. C08 prioritizes status/date/time/venue, then QR/PIN and arrival instructions; cancellation and extension show eligibility. C11 makes the staff decision and additional payment distinct, keeps the existing end time visible until final confirmation, and displays the actual server deadline rather than promising five more minutes after approval.

P02/P05 prioritize arrivals, table readiness, end times and conflicts. P06 provides large check-in/checkout controls with clear identity and state. P03/P04 separate a saved draft from published availability. P07 and A05 distinguish revenue, payable, pending payout and refunded value; do not use one ambiguous “earnings” number. A03/A04 show a chronological audit timeline and reasoned actions, not editable financial status dropdowns.

See the App Flow screen inventory for required data on every route. Empty, denied, expired, offline and suspended states receive designed screens with the appropriate next action.

## 5. Accessibility and interaction states

Target WCAG 2.2 AA (**P**) for web and equivalent native accessibility: text contrast at least 4.5:1, large text 3:1; meaningful non-text controls 3:1; visible focus, logical reading order, skip link and semantic headings. Web flows work by keyboard; native flows support VoiceOver/TalkBack and external keyboard where applicable. Proposed product target: at least 44×44px/pt controls with spacing, and at least 48dp on Android. Do not block zoom/text scaling. Label icon-only actions, connect errors to fields and announce asynchronous results without moving focus unexpectedly. References checked 25 October 2026: [W3C WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/), [Android touch target guidance](https://support.google.com/accessibility/android/answer/7101858).

Date/time controls must have keyboard and typed-input alternatives. Provide list/address alternatives to maps and PIN/manual input alternatives to QR/camera. Use reduced-motion preferences; no decorative motion during payment. A timer updates visually each second but screen readers receive meaningful warnings, not every tick. Explain the time-limited hold and allow a fresh attempt after expiry while preserving safe form input; do not silently extend reserved inventory. The accessibility review must assess WCAG Timing Adjustable, including whether an essential-timing exception applies to this reservation design; a countdown plus Retry alone is not evidence of conformance.

Hover changes appearance without revealing essential-only content. Focus is clearly outlined. Disabled controls explain eligibility nearby. Loading shows task-specific text, preserves layout and prevents duplicate mutation. Errors identify the problem and recovery while keeping input. Success remains on the page with its resulting state. Destructive confirmation states refund/availability consequences before committing.

## 6. Assets and design acceptance

**Supplied 26 Oct 2026 (owner):** PNG monogram and lockup in olive (`#373822`) and cream (`#F5F1E5`), in `references/brand/logo/`; derived icons/splash/web marks are produced by `scripts/generate-brand-assets.py` without recolouring or redrawing. Usage: cream marks on olive surfaces, olive marks on cream/light surfaces; the lockup's tagline is too fine below ~180 px width, so small placements (header, favicon, app icon, splash) use the monogram. The logo olive is darker than the UI token `brand.primary` (#4F5A3F); UI tokens are unchanged pending owner direction. The olive lockup's tagline rules are pure black (`#000000`), not logo olive.

Still needed: vector (SVG/PDF) or >=1024 px masters of the monogram and wordmark; licensed font files; real venue exterior/interior/table/entrance photographs; concise photo alternatives; one consistent accessible line-icon family; verified amenity icons; legal/policy copy; customer and staff empty-state illustrations only if useful. Do not use invented venue photos or amenities in a published listing.

Before implementation approval, prepare annotated web/native mockups for search, venue, table/time, checkout, pending/failure/success, booking, cancellation and extension; responsive-web mockups for partner calendar, check-in/readiness and admin refund. Test a first-time booking on customer web, Android and iOS, a staff arrival on compact web, keyboard-only navigation, 200% web zoom, native text scaling, VoiceOver/TalkBack labels and all payment uncertainty/app-return states. Record issues and revise before paid launch. A polished happy-path screenshot alone is not design acceptance.
