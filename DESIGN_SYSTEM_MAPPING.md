# SimplySit — Design System & Screen Mapping

**Figma File:** `DA7i1rigZ1Mjb0lLX7ndV2` (`simply-sit (Copy)`)  
**Statuses updated:** 16 November 2026 (frame lists for pages 06 and 10 re-read from Figma on that date)

---

## 1. Color Tokens (`04 — Color & Typography`, Nodes `94:123` & `94:167`)

| Semantic Token | Figma Light (`94:123`) | Figma Dark (`94:167`) | Current `design-tokens` | Notes |
| --- | --- | --- | --- | --- |
| `color/canvas` | `#F6F2E9` | `#171C18` | `#F6F4EF` | Update light to `#F6F2E9`, add dark `#171C18` |
| `color/surface` | `#FFFFFF` | `#222A23` | `#FFFFFF` | Add dark `#222A23` |
| `color/surface-muted` | `#F3F6F0` | `#303C30` | `#EAEDE3` (`noticeSurface`) | Align muted surface token |
| `color/border` | `#E6E1D6` | `#485344` | — | Add explicit border token |
| `color/text-primary` | `#282A25` | `#F6F2E9` | `#2E2E2E` | Update light to `#282A25`, add dark `#F6F2E9` |
| `color/text-secondary` | `#596153` | `#C3CBBB` | `#66685F` | Update light to `#596153`, add dark `#C3CBBB` |
| `color/action` | `#526440` | `#DCE3D2` | `#4F5A3F` (`brandPrimary`) | Keep `#4F5A3F` brand primary alias + `#526440` action |
| `color/success` | `#36804D` | `#A9D7A6` | `#27623A` / `#2E7D32` | Align + add dark `#A9D7A6` |
| `color/warning` | `#9A4800` | `#FFC48D` | `#805400` | Align + add dark `#FFC48D` |
| `color/error` | `#A53D36` | `#FFB5AF` | `#A52A2A` | Align + add dark `#FFB5AF` |
| Brand Sage / Sand | `#A3B18A` / `#DCCFBC` | — | `#A3B18A` / `#DCCFBC` | Preserved brand accents |

---

## 2. Typography Scale (`04 — Color & Typography`, Nodes `94:211`–`94:221`)

- **Editorial / Display (`Playfair Display`):** `Display / 48` (58px lh), `Editorial / 36` (44px lh), `Editorial / 28` (36px lh).
- **UI & Body (`Montserrat`):** `Heading / 24` (32px lh), `Heading / 20` (28px lh), `Heading / 18` (26px lh), `UI / 16 Medium` (24px lh), `Body / 16` (24px lh), `Body / 14` (22px lh), `Label / 14` (20px lh), `Meta / 12` (18px lh).

---

## 3. UI Kit Component Mapping (`18 — Product UI Kit & Components`, Node `2019:25`)

Built components live in `apps/web/components/ui/` (`button.tsx`, `form.tsx`, `feedback.tsx`, `overlay.tsx`, `image-gallery.tsx`, `recovery-banner.tsx`, styles in `ui.css`). "Adopted" means pages actually import it.

| Figma Component | Node ID | Web component | Status (16 Nov) |
| --- | --- | --- | --- |
| `SS / Button`, `SS / Icon button` | `94:271`, `94:276` | `Button`, `IconButton` | Built; adopted on 3 admin pages only, other pages use `.button` classes |
| `SS / Input`, `SS / Search bar`, `SS / Dropdown`, `SS / Checkbox`, `SS / Radio group`, `SS / Switch` | `94:294`-`94:548`, `2019:54`, `2019:59` | `Field`, `Input`, `Textarea`, `Select`, `SearchBar`, `Checkbox`, `RadioGroup`, `Switch` | Built; barely adopted |
| `SS / Badge`, `SS / Status indicator` | `94:375` range | `Badge`, `StatusIndicator` | Built; pages still use `.status-pill` |
| `SS / KPI card` | `94:497` | `KpiCard` | Built; portal pages still use `.metric` |
| `SS / Modal`, `SS / Drawer`, `SS / Toast`, `SS / Alert`, `SS / Tooltip` | `94:435`-`94:473`, `94:541` | `Modal`, `Drawer`, `ConfirmDialog`, `ToastProvider`, `Alert`, `Tooltip` | Built; `ToastProvider` mounted in `layout.tsx`, others unused |
| `SS / Pagination`, `SS / Empty state`, `SS / Loading skeleton`, `SS / Breadcrumbs` | `94:485`, `94:527`, `94:538`, `94:488` | `Pagination`, `EmptyState`, `ErrorState`, `Skeleton`, `Breadcrumbs` | Built; adopted on 3 admin pages |
| Image gallery | `94:17490` | `ImageGallery` | Built and used on `/venues/[id]` |
| Recovery states | `94:16726`-`94:17030` | `.outcome` layout in `payment-return.tsx` | Implemented 16 Nov; `RecoveryBanner` removed |
| `SS / Navigation bar`, `SS / Sidebar` | `94:407`, `94:414` | `site-nav.tsx`, `lib/partner-page.tsx`, `lib/admin-nav.tsx` | Implemented outside the kit |
| `SS / Tabs`, filter chip | `94:419` | — | **Not built** (pages use `.tabs`, `.chip` classes) |
| `SS / Card`, `SS / Venue card`, `SS / Booking card`, `SS / Table row` | `94:341`-`94:393` | — | **Not built** (class-based markup; `booking-parts.tsx`) |
| `SS / Date picker`, `SS / Time selector` | `94:324`, `94:334` | — | **Not built** (native selects in `book-flow.tsx` and `/venues/[id]`) |
| `SS / QR booking card`, `SS / Payment status`, `SS / Rating summary` | `2019:100`, `2019:93`, `2019:111` | — | **Not built** as kit components; partial in `booking-parts.tsx` |
| `SS / Bottom sheet`, `SS / Data visualization` | — | — | Not built; `.bar-chart` class only |

---

## 4. Screen-to-Route Mapping

### Customer Web (`07 — Customer Responsive Web`, `94:8` & `10 — Notifications & System States`, `94:11`)
| Figma Frame | Node ID | Existing Web Route | Status |
| --- | --- | --- | --- |
| `Web · Discover and results` | `94:11521` | `/`, `/venues` | Implemented |
| `Web · Venue detail and booking` | `94:11698` | `/venues/[id]` | Implemented; rebuilt 12 Nov with booking card and gallery |
| `E · Customer web · Sign-in and OTP` | `94:11853` | `/sign-in` | Implemented (email OTP) |
| `E · Customer web · Select table and time` | `94:11921` | `/venues/[id]/book` | Implemented |
| `E · Customer web · Checkout and payment` | `94:12033` | `/checkout/[bookingId]` | Implemented |
| `E · Customer web · Confirmed booking pass` | `94:12124` | `/bookings/[id]` | Implemented |
| `E · Customer web · My bookings and receipts` | `94:12196` | `/bookings` | Implemented |
| `E · Customer web · Active booking and extension` | `94:12285` | `/bookings/[id]/extend` | Implemented |
| `E · Customer web · Cancellation and refund tracking` | `94:12401` | `/bookings/[id]/cancel` | Implemented |
| `E · Customer web · Account and support centre` | `94:12507` | `/account`, `/help`, `/support/[id]` | Implemented |
| `Notifications · Customer notification centre` | `94:21901` | `/notifications` | Implemented |
| `B · Payment pending / failed / expired / unavailable` | `94:16726`–`94:17030` | `/checkout/[bookingId]`, `/payment/return`, `/venues/[id]/book`, `/bookings/[id]/extend` | Implemented: checkout, book and extend pages already show these states; `/payment/return` got a state layout 16 Nov. `RecoveryBanner` removed (its fixed copy was less accurate than the server-derived text) |

### Partner Dashboard (`08 — Partner Dashboard`, `94:9`)
| Figma Frame | Node ID | Existing Web Route | Status |
| --- | --- | --- | --- |
| `Partner · Today and booking operations` | `94:12721` | `/partner`, `/staff` | Implemented |
| `Partner · Inventory and availability calendar` | `94:12946` | `/partner/calendar` | Implemented |
| `Partner · Weekly inventory` / `Table and pricing editor` | `94:18003`, `94:13737` | `/partner/inventory` | Implemented |
| `Partner · Venue profile and setup` / `Photo management` | `94:13195`, `94:18322` | `/partner/venue` | Implemented |
| `Partner · Earnings and settlements` / `Owner finance` | `94:13400`, `94:14354` | `/partner/payouts` | Implemented |
| `C · Partner desktop · New-partner onboarding` | `94:13603` | `/partner/apply` | Implemented |
| `C · Partner desktop · Add closure and review impacts` | `94:13860` | `/partner/closures` | Implemented |
| `C · Partner desktop · Team and permissions` | `94:13984` | `/partner/staff` | Implemented |
| `C · Partner desktop · Report incident` | `94:14130` | `/partner/incidents/new` | Implemented |
| `C · Partner desktop · Check-out and protected turnover` | `94:14225` | `/partner/bookings/[id]` | Implemented |
| `Partner · Reports and exports` | `94:18577` | `/partner/reports` | Implemented |
| `Partner · Scan & validate / Checked in / Cleaning / Ready` | `94:19115`–`94:19848` | `/staff` (now inside the partner workspace) | Implemented 16 Nov: check-in confirmation panel; table cards show cleaning / occupied / ready with the next reservation. One screen with states, not four separate pages |
| `F · Partner mobile` (4 frames) | `94:14492`–`94:14749` | Responsive `/partner`, `/staff` | Partial: swipeable menu and two-across figures on phones (12 Nov); frames not compared one by one |

### Admin Dashboard (`09 — Admin Dashboard`, `94:10`)
| Figma Frame | Node ID | Existing Web Route | Status |
| --- | --- | --- | --- |
| `Admin · Marketplace overview` | `94:15132` | `/admin` | Implemented |
| `Admin · Partner review` | `94:15350` | `/admin/venues`, `/admin/venues/[id]` | Implemented |
| `Admin · Booking and settlement operations` | `94:15548` | `/admin/bookings`, `/admin/finance` | Implemented |
| `D · Admin desktop · Refunds and disputes queue` | `94:15783` | `/admin/finance/refunds` | Implemented |
| `D · Admin desktop · Support and safety incidents` | `94:15957` | `/admin/support`, `/admin/support/[id]` | Implemented |
| `D · Admin desktop · Review moderation` | `94:16120` | `/admin/reviews` | Implemented |
| `D · Admin desktop · Future fee configuration` | `94:16271` | `/admin/finance/fees` | Implemented |
| `D · Admin desktop · Reports and exports` | `94:16412` | `/admin/metrics` | Implemented |
| `Admin · Payment reconciliation` | `94:21409` | `/admin/finance/reconciliation` | Implemented |
| `Admin · Customer management` | `94:20083` | `/admin/customers` | Implemented 14 Nov (not compared with the frame in this audit) |
| `Admin · Partner and venue management` | `94:20344` | `/admin/directory` | Implemented 16 Nov: searchable, read-only directory linking to the review record. No pause-listing action (no audited flow exists) |
| `Admin · System settings` | `94:20609` | `/admin/settings` | Implemented 16 Nov as read-only configuration; no editable settings (no reviewed change flow exists) |
| `Admin · Admin users and permissions` | `94:20861` | `/admin/users` | Implemented 14 Nov (not compared with the frame in this audit) |
| `Admin · Audit log` | `94:21141` | `/admin/audit` | Implemented 14 Nov (not compared with the frame in this audit) |
| `Admin · Secure admin access` | `94:21670` | portal gate (`lib/portal-page.tsx`), `/account/security` | Implemented 16 Nov: the blocked and authenticator-required states use one access card; sign-in stays the shared email-code page |

### Notifications and system states (`10 — Notifications & System States`, `94:11`)
| Figma Frame | Node ID | Existing route | Status |
| --- | --- | --- | --- |
| `G · System state · Empty customer results` | `94:17110` | `/venues` | Partial: plain notice, not the kit `EmptyState` |
| `G · System state · Loading and recoverable error` | `94:17175` | `loading.tsx`, `error.tsx`, `not-found.tsx` | Implemented (12 Nov) |
| `G · System state · Offline cached booking pass` | `94:17292` | Expo `booking/[id]` | **Missing** |
| `Notifications · Partner notification centre` | `94:21953` | `/partner/notifications` | Implemented 16 Nov (the signed-in person's own inbox inside the workspace) |
| `Notifications · Admin notification centre` | `94:22194` | `/admin/notifications` | Implemented 16 Nov (own inbox; queue alerts stay on Overview/Finance) |
| `Notifications · Notification preferences` | `94:22428` | `/account/notifications` | Implemented 16 Nov: table `notification_preferences`, `GET/PUT /api/v1/me/notification-preferences`; optional email copies honoured by `app.notify_user` |
| `Notifications · Notification preview` | `94:22480` | — | Native push preview; not applicable to web |
| `Notifications · Interaction states and feedback` | `94:22512` | kit `ToastProvider`, `Alert` | Built, not adopted |

### Customer mobile (`06 — Customer Mobile`, `94:7`) to the Expo app (`apps/mobile/app`)
Restyle status comes from the 9 November handoff; no screen was checked on a device in this audit.

| Figma Frame | Node ID | Expo screen | Status |
| --- | --- | --- | --- |
| `Customer · Discover` | `94:9701` | `(tabs)/index.tsx` | Restyled 9 Nov, with empty/loading/error states |
| `Customer · Search results` | `94:9836` | `(tabs)/index.tsx` | Restyled 9 Nov |
| `Customer · Venue detail` | `94:9976` | `venue/[id].tsx` | Restyled 19 Nov; checked on the Android emulator |
| `Customer · Select table and time` | `94:10119` | `book.tsx` | Works; restyle pending |
| `Customer · Checkout and payment` | `94:10244` | `checkout/[bookingId].tsx` | Works; restyle pending |
| `Customer · Confirmed booking pass` | `94:10372` | `booking/[id].tsx` | Works; restyle pending |
| `Customer · My bookings` | `94:10467` | `(tabs)/bookings.tsx` | Works; restyle pending |
| `Customer · Active booking and extension` | `94:10575` | `extend/[bookingId].tsx` | Works; restyle pending |
| `Customer · Cancellation refund and help` | `94:10690` | `cancel/[bookingId].tsx`, `(tabs)/help.tsx` | Works; restyle pending |
| `A · Sign in`, `A · Verify OTP`, `Customer · Email sign-in` | `94:10818`, `94:10876`, `94:17657` | `(tabs)/account.tsx` | Restyled 9 Nov (email code, not SMS) |
| `A · Manual location` | `94:10943` | `location.tsx` | Restyled 9 Nov |
| `A · Account` | `94:11015` | `(tabs)/account.tsx` | Restyled 9 Nov |
| `A · Completed-stay review` | `94:11087` | `review/[bookingId].tsx` | Restyled 9 Nov |
| `A · Create support ticket` | `94:11175` | `support/new.tsx` | Restyled 9 Nov |
| `A · Support case detail` | `94:11240` | `support/[id].tsx` | Works; restyle pending |
| `A · Review cancellation` | `94:11328` | `cancel/[bookingId].tsx` | Works; restyle pending |
| `Customer · Advanced filters` | `94:17429` | — | **Missing** |
| `Customer · Venue gallery` | `94:17490` | `gallery/[id].tsx` | Implemented 19 Nov; checked on the Android emulator |
| `Customer · Date and time calendar` | `94:17537` | — | **Missing** (native selects today) |
| `Customer · Privacy and preferences` | `94:17597` | — | **Missing** |
| `Customer · Nearby spaces · Map` | `94:17707` | `(tabs)/index.tsx` | Not verified |
| `B · Payment pending / failed / hold expired / slot unavailable / extension unavailable` | `94:16726`-`94:17030` | `payment-return.tsx`, `checkout`, `book`, `extend` | Works functionally; state screens pending |

### Added 16 Nov, not in the earlier tables
| Figma Frame | Node ID | Route | Status |
| --- | --- | --- | --- |
| `Partner · Support centre` | `94:18856` | `/partner/support` | Implemented: own cases table and the existing ticket form; case conversation opens on `/support/[id]` (customer layout) |
