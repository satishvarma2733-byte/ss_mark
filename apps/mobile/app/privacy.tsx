// Customer privacy and preferences - Figma "Customer · Privacy and preferences" (94:17597). Essential booking and
// security messages are always on; email copies and offers are optional (PUT /me/notification-preferences). Privacy
// requests: a copy of your data (EXPORT) or account closure (DELETE, which needs a fresh sign-in). Location is asked
// only when the guest taps "Use my location" on the area screen. The design's appearance setting is not built: the
// native app has no dark theme yet.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { ApiError } from "@simply-sit/api-client";
import type { NotificationPreferences } from "@simply-sit/contracts";
import { colors, spacing } from "@simply-sit/design-tokens";
import { Screen } from "../components/shell";
import { Button, Card, Divider, Notice, ui } from "../components/ui";
import { api } from "../lib/api";
import { formatIstDate } from "../lib/format";
import { useSession } from "../lib/session";

function Row({ label, hint, value, onChange, locked, testID }: {
  label: string; hint?: string; value: boolean; onChange?: (v: boolean) => void; locked?: boolean; testID?: string;
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={ui.body}>{label}</Text>
        {hint ? <Text style={ui.small}>{hint}</Text> : null}
      </View>
      {locked ? <Text style={ui.label}>Always on</Text> : (
        <Switch value={value} onValueChange={onChange} accessibilityLabel={label} testID={testID}
          trackColor={{ true: colors.brandPrimary, false: colors.brandSand }} />
      )}
    </View>
  );
}

export default function PrivacyScreen() {
  const { ready, session } = useSession();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [copies, setCopies] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!api || !session) return;
    try {
      const p = await api.getNotificationPreferences();
      setPrefs(p);
      setCopies(p.email_copies);
      setMarketing(p.marketing);
    } catch {
      setMessage({ tone: "error", text: "Could not load your preferences. Check your connection and try again." });
    }
  }, [session]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!api) return;
    setBusy("save");
    setMessage(null);
    try {
      const p = await api.setNotificationPreferences({ email_copies: copies, marketing });
      setPrefs(p);
      setMessage({ tone: "success", text: "Preferences saved." });
    } catch {
      setMessage({ tone: "error", text: "Could not save your preferences. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function requestData() {
    if (!api) return;
    setBusy("export");
    setMessage(null);
    try {
      const r = await api.requestPrivacy("EXPORT");
      setMessage({ tone: "success", text: `Request received (${r.status.toLowerCase().replace(/_/g, " ")}). We’ll email your verified address when your copy is ready.` });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof ApiError && e.code === "REAUTH_REQUIRED"
        ? "For your security, sign out and sign in again with a fresh code, then ask again."
        : "Could not create the request. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function requestClosure() {
    Alert.alert(
      "Close your account?",
      "New bookings pause straight away. Active bookings, payments and refunds are reviewed first, and records we must keep for finance or audit are kept in pseudonymous form.",
      [
        { text: "Keep my account", style: "cancel" },
        {
          text: "Request closure",
          style: "destructive",
          onPress: async () => {
            if (!api) return;
            setBusy("delete");
            try {
              const r = await api.requestPrivacy("DELETE");
              setMessage({ tone: "info", text: `Closure request received (${r.status.toLowerCase().replace(/_/g, " ")}). New bookings are paused.` });
            } catch (e) {
              setMessage({ tone: "error", text: e instanceof ApiError && e.code === "REAUTH_REQUIRED"
                ? "For your security, sign out and sign in again with a fresh code, then request closure."
                : "Could not create the request. Try again." });
            } finally {
              setBusy(null);
            }
          }
        }
      ]
    );
  }

  if (!ready) {
    return (
      <Screen title="Privacy and preferences" back nav="account">
        <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading" />
      </Screen>
    );
  }
  if (!session) {
    return (
      <Screen title="Privacy and preferences" back nav="account">
        <Notice title="Sign in to manage your privacy">
          <Text style={ui.noticeText}>Your choices and data requests are tied to your verified account.</Text>
        </Notice>
        <Button label="Sign in on the Account tab" onPress={() => router.navigate("/account")} />
      </Screen>
    );
  }
  const dirty = !!prefs && (prefs.email_copies !== copies || prefs.marketing !== marketing);
  return (
    <Screen title="Privacy and preferences" subtitle={`Bengaluru · ${formatIstDate(new Date().toISOString())} · Asia/Kolkata`} back nav="account">
      <Card title="Your data, your choice">
        {!prefs ? <ActivityIndicator color={colors.brandPrimary} accessibilityLabel="Loading preferences" /> : (
          <>
            <Row label="Essential booking & security messages" hint="Booking, payment, refund and sign-in messages." value locked />
            <Divider />
            <Row label="Email booking copies" hint="A copy of booking updates by email." value={copies} onChange={setCopies} testID="pref-email-copies" />
            <Divider />
            <Row label="Offers & marketing" hint="Occasional news about new spaces. Off unless you turn it on." value={marketing} onChange={setMarketing} testID="pref-marketing" />
            <Text style={ui.small}>Essential messages help protect your account and keep active bookings usable. Marketing is optional.</Text>
            <Button label="Save preferences" onPress={() => void save()} busy={busy === "save"} disabled={!dirty || busy !== null} testID="save-preferences" />
          </>
        )}
      </Card>

      <Card title="Location access">
        <Text style={ui.body}>Asked only when you tap “Use my location”. You can always choose an area by name instead.</Text>
        <Text style={ui.small}>When used, your location is rounded to about 1 km before it leaves your phone.</Text>
        <Button label="Choose your area" variant="secondary" onPress={() => router.push("/location")} />
      </Card>

      <Card title="Privacy requests">
        <Text style={ui.body}>Ask for a copy of your personal information or to close your account. We’ll explain any records we must keep by law.</Text>
        <Button label="Request my data" variant="secondary" onPress={() => void requestData()} busy={busy === "export"} disabled={busy !== null} testID="request-data" />
        <Button label="Request account closure" variant="secondary" onPress={requestClosure} busy={busy === "delete"} disabled={busy !== null} testID="request-closure" />
        <Text style={ui.small}>Never share a one-time code with support.</Text>
      </Card>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 }
});
