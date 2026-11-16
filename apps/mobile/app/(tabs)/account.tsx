import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { ApiError } from "@simply-sit/api-client";
import type { Me } from "@simply-sit/contracts";
import { colors, radius } from "@simply-sit/design-tokens";
import { Button, Card, DetailRow, Divider, Field, Notice, StatusPill, fonts, tints, ui } from "../../components/ui";
import { Screen } from "../../components/shell";
import { api } from "../../lib/api";
import { clearPendingPayment } from "../../lib/pending-payment";
import { supabase } from "../../lib/supabase";
import venuePhoto from "../../assets/brand/sign-in-venue.jpg";

// C14 Account (native) - Figma "A · Customer mobile · Sign in", "Verify OTP" and "Account". Email one-time code via the
// Supabase SDK (the frames show phone + SMS; email stays until an SMS provider is chosen). The session is kept in
// secure storage only.
export default function AccountScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = useCallback(async () => {
    if (!api) return;
    try {
      setMe(await api.getMe());
    } catch (error) {
      if (error instanceof ApiError && (error.code === "SESSION_EXPIRED" || error.code === "AUTH_REQUIRED")) {
        await supabase?.auth.signOut({ scope: "local" });
        setMessage("Your session ended. Please sign in again.");
      } else {
        setMessage("We could not load your account. Check your connection and try again.");
      }
    }
  }, []);

  useEffect(() => {
    if (session) void loadMe();
    else setMe(null);
  }, [session, loadMe]);

  if (!ready) {
    return (
      <Screen title="Your account">
        <ActivityIndicator accessibilityLabel="Loading account" />
      </Screen>
    );
  }
  if (!supabase || !api) {
    return (
      <Screen title="Not signed in">
        <Notice tone="warning" title="Sign-in is not configured">
          This build has no EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_API_URL.
        </Notice>
      </Screen>
    );
  }

  const status = message ? (
    <Text style={ui.muted} accessibilityLiveRegion="polite" accessibilityRole="alert">
      {message}
    </Text>
  ) : null;

  return session ? (
    <Screen title="Your account" subtitle={session.user.email ?? undefined}>
      <SignedIn email={session.user.email ?? ""} me={me} onChanged={loadMe} onMessage={setMessage} />
      {status}
    </Screen>
  ) : (
    <SignInForm onMessage={setMessage} onSignedIn={loadMe} status={status} />
  );
}

function SignInForm({ onMessage, onSignedIn, status }: { onMessage: (m: string | null) => void; onSignedIn: () => Promise<void>; status: ReactNode }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const codeInput = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function requestCode() {
    setBusy(true);
    onMessage(null);
    setCodeError(false);
    const { error } = await supabase!.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error && error.status === 429) onMessage("Too many attempts. Wait a minute and try again.");
    else if (error) onMessage("We could not send a code. Try again.");
    else {
      setStep("code");
      setCode("");
      setResendIn(60);
      onMessage("If this email can sign in, a code is on its way. It expires in 10 minutes.");
    }
  }

  async function verify() {
    setBusy(true);
    onMessage(null);
    const { error } = await supabase!.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    if (error) {
      setBusy(false);
      setCodeError(true);
      return;
    }
    if (acceptTerms) {
      try {
        const me = await api!.getMe();
        if (me.terms_required) await api!.acceptTerms(me.current_terms_version, me.current_privacy_version);
      } catch {
        onMessage("Signed in, but accepting the terms failed. Try again from this screen.");
      }
      // The session listener already loaded /me when the code verified; reload it so terms status is current.
      await onSignedIn();
    }
    setBusy(false);
  }

  if (step === "code") {
    const masked = email.includes("@") ? `${email.slice(0, 1)}••••••${email.slice(email.indexOf("@"))}` : email;
    return (
      <Screen title="Verify your email" subtitle="Enter the code we sent">
        <Card title="Enter your six-digit code">
          <Text style={ui.body}>Sent to {masked}</Text>
          <Pressable onPress={() => { setStep("email"); setCodeError(false); onMessage(null); }} accessibilityRole="button" style={styles.textLink}>
            <Text style={styles.textLinkText}>Edit email →</Text>
          </Pressable>
          <Pressable onPress={() => codeInput.current?.focus()} accessible={false} style={styles.otpRow}>
            {Array.from({ length: 6 }, (_, i) => (
              <View key={i} style={[styles.otpBox, codeError && styles.otpBoxError, i === Math.min(code.length, 5) && !codeError && styles.otpBoxCurrent]}>
                <Text style={styles.otpDigit}>{code[i] ?? ""}</Text>
              </View>
            ))}
            <TextInput
              ref={codeInput}
              style={styles.otpInput}
              value={code}
              onChangeText={(v) => { setCode(v.replace(/\D/g, "").slice(0, 6)); setCodeError(false); }}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              accessibilityLabel="6-digit code"
              autoFocus
              caretHidden
            />
          </Pressable>
          {codeError ? (
            <Notice tone="error" title="Incorrect code">
              That code is not valid or has expired. Check the email and try again. You are not signed in yet.
            </Notice>
          ) : null}
          <Button label={busy ? "Checking…" : "Verify & continue"} onPress={verify} disabled={busy || code.length !== 6} />
          {resendIn > 0 ? (
            <Text style={[ui.small, styles.center]}>Resend code in 00:{String(resendIn).padStart(2, "0")}</Text>
          ) : (
            <Pressable onPress={requestCode} accessibilityRole="button" style={[styles.textLink, styles.selfCenter]} disabled={busy}>
              <Text style={styles.textLinkText}>Resend code</Text>
            </Pressable>
          )}
        </Card>
        {status}
        <Notice title="Keep it private">Never share your code. Simply Sit support will never ask for a verification code or UPI PIN.</Notice>
      </Screen>
    );
  }

  return (
    <Screen title="Welcome to Simply Sit" subtitle="Sign in or create your account">
      <Image source={venuePhoto} style={[ui.photo, styles.hero]} resizeMode="cover" accessible={false} />
      <Text style={ui.display}>A little space.{"\n"}All yours.</Text>
      <Text style={ui.muted}>Your account keeps your bookings and check-in pass in one place.</Text>
      <Card title="Let’s get you settled">
        <Field label="Email address" hint="We’ll send a six-digit verification code.">
          <TextInput style={ui.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="Email" />
        </Field>
        <View style={styles.checkRow}>
          <Switch value={acceptTerms} onValueChange={setAcceptTerms} accessibilityLabel="Accept the draft terms and privacy notice"
            trackColor={{ true: colors.brandSage, false: colors.brandSand }} thumbColor={acceptTerms ? colors.brandPrimary : colors.surfaceCard} />
          <Text style={[ui.small, styles.flex, styles.checkText]}>I agree to the Terms of use and acknowledge the Privacy notice. Required before your first booking.</Text>
        </View>
        <Button label={busy ? "Sending…" : "Send verification code"} onPress={requestCode} disabled={busy || !email.includes("@")} />
      </Card>
      {status}
      <Notice title="Only what’s necessary">
        No password, date of birth or identity document needed. Your email is used for account security and booking updates.
      </Notice>
    </Screen>
  );
}

function SignedIn(props: { email: string; me: Me | null; onChanged: () => Promise<void>; onMessage: (m: string | null) => void }) {
  const { email, me, onChanged, onMessage } = props;
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    // Revokes the session at the Auth server and removes it from secure storage, with the in-flight payment marker.
    await supabase!.auth.signOut();
    await clearPendingPayment();
    setBusy(false);
    onMessage("Signed out.");
  }

  async function acceptTerms() {
    if (!me) return;
    setBusy(true);
    try {
      await api!.acceptTerms(me.current_terms_version, me.current_privacy_version);
      await onChanged();
    } catch {
      onMessage("Could not record acceptance. Try again.");
    }
    setBusy(false);
  }

  function confirmDeletion() {
    Alert.alert(
      "Request account deletion?",
      "New bookings pause straight away. Active bookings, payments and refunds are reviewed first, and records we must keep for finance or audit are kept in pseudonymous form.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Request deletion",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await api!.requestPrivacy("DELETE");
              onMessage(`Deletion request received (${result.status}). New bookings are paused.`);
              await onChanged();
            } catch (error) {
              onMessage(error instanceof ApiError && error.code === "REAUTH_REQUIRED"
                ? "For your security, sign out and sign in again with a fresh code, then request deletion."
                : "Could not create the request. Try again.");
            }
          }
        }
      ]
    );
  }

  return (
    <>
      <Card title="The essentials">
        <Field label="Email">
          <Text style={[ui.input, styles.staticInput]} testID="account-email">
            {email}
          </Text>
        </Field>
        {me ? (
          <>
            <StatusPill label={`Email verified · ${me.status}`} tone={me.status === "ACTIVE" ? "success" : "warm"} testID="account-status" />
            {me.venue_memberships.length > 0 ? (
              <DetailRow label="Venue roles" value={me.venue_memberships.map((m) => `${m.role} at ${m.venue_name}`).join("; ")} />
            ) : null}
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Loading profile" />
        )}
        <Text style={ui.hint}>No identity document or date of birth required.</Text>
      </Card>

      {me?.terms_required ? (
        <Card title="Terms">
          <Text style={ui.muted}>Accept the current draft terms ({me.current_terms_version}) and privacy notice before booking.</Text>
          <Button label="Accept current terms" onPress={acceptTerms} disabled={busy} />
        </Card>
      ) : null}

      <Card title="Your preferences">
        <DetailRow label="Booking & payment updates" value="Always on" />
        <Text style={ui.hint}>Essential updates are sent to your verified email.</Text>
        <Divider />
        <DetailRow label="Marketing messages" value="Not sent" />
        <DetailRow label="City" value="Bengaluru (pilot)" />
      </Card>

      <Card title="Privacy & help">
        {me?.status === "DELETION_PENDING" ? (
          <Text style={ui.muted}>A deletion request is in review. New bookings are paused.</Text>
        ) : (
          <LinkRow label="Privacy & data requests" onPress={confirmDeletion} disabled={busy || !me} />
        )}
        <Divider />
        <LinkRow label="Help centre & your cases" onPress={() => router.navigate("/help")} />
      </Card>

      <Button label="Sign out" variant="secondary" onPress={signOut} disabled={busy} />
    </>
  );
}

function LinkRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={styles.linkRow}>
      <Text style={styles.textLinkText}>{label} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  selfCenter: { alignSelf: "center" },
  hero: { height: 190 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { color: colors.textPrimary },
  textLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  textLinkText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brandPrimary },
  linkRow: { minHeight: 44, justifyContent: "center" },
  staticInput: { textAlignVertical: "center" },
  otpRow: { flexDirection: "row", gap: 6 },
  otpBox: {
    flex: 1, height: 52, borderWidth: 1, borderColor: colors.brandSand, borderRadius: radius.button, alignItems: "center",
    justifyContent: "center", backgroundColor: colors.surfaceCard
  },
  otpBoxCurrent: { borderColor: colors.brandPrimary, borderWidth: 2 },
  otpBoxError: { borderColor: tints.errorText },
  otpDigit: { fontFamily: fonts.semibold, fontSize: 20, color: colors.textPrimary },
  otpInput: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: "transparent" }
});
