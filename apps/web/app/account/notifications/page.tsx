import { redirect } from "next/navigation";
import { asUser, getDb, myNotificationPreferences } from "@simply-sit/db";
import { resolveIdentity } from "../../../lib/auth/identity";
import { PreferencesForm } from "./preferences-form";

export const dynamic = "force-dynamic";

// Figma "Notifications · Notification preferences" (94:22428): essential messages are fixed; two optional choices.
export default async function NotificationPreferencesPage() {
  const identity = await resolveIdentity();
  if (identity.kind !== "user") redirect("/sign-in?redirect_path=/account/notifications");
  const preferences = await asUser(getDb(), identity.claims, (tx) => myNotificationPreferences(tx));
  return (
    <main>
      <p className="back-row">
        <a className="back-link" href="/account">
          Back to account
        </a>
      </p>
      <h1>Notification preferences</h1>
      <p className="lede">Choose where optional updates reach you.</p>
      <PreferencesForm initial={{ email_copies: preferences.email_copies, marketing: preferences.marketing }} />
    </main>
  );
}
