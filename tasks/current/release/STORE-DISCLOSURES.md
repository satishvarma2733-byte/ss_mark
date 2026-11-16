# Store disclosures draft (Google Play Data safety, Apple App Privacy)

Prepared 3 November 2026 from the customer app as built (`apps/mobile`, Expo SDK 58) and the API it calls. **Draft for
the owner's review:** the owner submits the forms in organization-owned store accounts, and must re-check this list
against the final release build, the store forms' current wording and any SDK added later (for example crash
reporting). Nothing has been submitted.

## What the customer app actually does

| Data | When | Leaves the device? | Stored by Simply Sit | Purpose | Linked to the person |
| --- | --- | --- | --- | --- | --- |
| Email address | Sign-in with an emailed code (Supabase Auth) | Yes | Yes (account) | Account, booking messages | Yes |
| Approximate location | Only after tapping "Use my location" (foreground, coarse permission only) | Yes, rounded to about 1 km (`coarseCoordinate`) | No: used for that search, never logged | Show nearby spaces | No (not stored) |
| Bookings and payments made (purchase history) | Booking | Yes | Yes | Provide the service, receipts, refunds, finance records | Yes |
| Payment card/UPI details | Never in the app: the provider's checkout page opens in the system browser | Not by the app | No | - | - |
| Support messages | Customer writes a support request | Yes | Yes | Customer support | Yes |
| Ratings and review text | After a completed visit | Yes | Yes (published only after moderation, without names) | Reviews | Yes |
| Session tokens | Signed in | Only to the Simply Sit API and Auth | Device: encrypted secure storage | Keep the person signed in | - |
| App version and platform (`android/0.1.0`) | Every API call | Yes | No | Refuse new bookings from unsupported versions | No |

Not collected: contacts, photos or files (customers upload nothing), camera or microphone (the customer shows its own
arrival QR; staff scan on the web portal), precise or background location (blocked in `app.json`), advertising ID,
device identifiers, analytics events, push tokens (in-app notifications only), crash logs (no crash SDK yet). No ads,
no data sold, no tracking across other companies' apps (Apple ATT not needed).

Security: HTTPS in transit (release builds block cleartext HTTP); tokens in platform secure storage; account deletion
is requested in the app (Account) or on the web (Account); deletion pauses new bookings, completes after open bookings,
refunds and legal retention (retention periods: owner decision D09).

## Google Play Data safety (proposed answers)

- Collects: Personal info > Email address (account management, app functionality; required); Location > Approximate
  location (app functionality; optional; processed ephemerally); Financial info > Purchase history (app functionality);
  Messages > Other in-app messages (support; optional); App activity > Other user-generated content (reviews; optional).
- Shared with third parties: not for advertising. Service providers acting for Simply Sit (hosting, Auth email, payment
  provider) are not "sharing" under Play's definition; the owner confirms each provider's role (D04, D09).
- Encrypted in transit: yes. Deletion request: yes, in app and on the web (Play also needs a public deletion URL:
  owner's domain, TBD).
- Permissions in the manifest to review before release: `ACCESS_COARSE_LOCATION`, `INTERNET`, `VIBRATE`, plus
  template permissions `SYSTEM_ALERT_WINDOW` and legacy storage (API <= 32) that the app does not use - see
  `RELEASE-PACKAGE.md` M6.D for the release-build manifest check and the proposed `blockedPermissions` change.

## Apple App Privacy (proposed answers)

- Data linked to the user: Contact info > Email address; Purchases > Purchase history; User content > Customer support,
  Other user content (reviews). Purpose: App functionality (and Customer support).
- Data not linked: Location > Coarse location (App functionality), not stored.
- Tracking: none. Privacy manifest: include required-reason API declarations from the Expo SDK at build time.

## Payments and review notes

- Bookings are for physical space at venues used outside the app, so the app uses the payment provider's checkout,
  not Apple/Google in-app purchase (Apple App Review Guideline 3.1.5(a) "goods and services outside of the app";
  Google Play Payments policy exemption for physical goods and services). Owner/legal confirms against the current
  guideline text at submission.
- Reviewer access: a reviewer account and a bookable fictional or real venue in a review environment, with the payment
  provider in test mode, and written steps (search, book, pay, arrival QR, cancel). Needs D04 and the store accounts.
- Account deletion in app: Account tab > request deletion (verified on the Android emulator in M5).
