import { useEffect, useRef } from "react";
import { router, Stack, useRootNavigationState } from "expo-router";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@simply-sit/design-tokens";
import { pendingPayment } from "../lib/pending-payment";

// Keep the splash screen up until the brand fonts are ready, so text never re-flows on first paint.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// On launch, a payment the customer left to complete resumes at its status screen, even if the provider's return
// link never arrived. The screen asks the server; nothing here assumes the payment succeeded.
function ResumePendingPayment() {
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const done = useRef(false);
  useEffect(() => {
    if (!navigationReady || done.current) return;
    done.current = true;
    void (async () => {
      const initial = await Linking.getInitialURL();
      if (initial && Linking.parse(initial).path === "payment-return") return;
      const orderId = await pendingPayment();
      if (orderId) router.push({ pathname: "/payment-return", params: { payment_order_id: orderId } });
    })();
  }, [navigationReady]);
  return null;
}

// Every screen draws the Figma chrome itself (components/shell.tsx), so the navigators show no headers.
export default function RootLayout() {
  // Brand kit fonts (SIL Open Font Licence, assets/fonts). If a font fails to load the app still runs on system fonts.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const [loaded, error] = useFonts({
    "Montserrat-Regular": require("../assets/fonts/Montserrat-Regular.ttf"),
    "Montserrat-Medium": require("../assets/fonts/Montserrat-Medium.ttf"),
    "Montserrat-SemiBold": require("../assets/fonts/Montserrat-SemiBold.ttf"),
    "PlayfairDisplay-Regular": require("../assets/fonts/PlayfairDisplay-Regular.ttf")
  });
  /* eslint-enable @typescript-eslint/no-require-imports */
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      {/* Edge-to-edge: the olive brand header paints behind the status bar (components/shell.tsx). */}
      <StatusBar style="light" />
      <ResumePendingPayment />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfaceCanvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="venue/[id]" />
        <Stack.Screen name="book" />
        <Stack.Screen name="checkout/[bookingId]" />
        <Stack.Screen name="payment-return" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="cancel/[bookingId]" />
        <Stack.Screen name="extend/[bookingId]" />
        <Stack.Screen name="review/[bookingId]" />
        <Stack.Screen name="support/[id]" />
        <Stack.Screen name="support/new" />
        <Stack.Screen name="location" />
        <Stack.Screen name="notifications" />
      </Stack>
    </SafeAreaProvider>
  );
}
