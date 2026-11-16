import { Tabs } from "expo-router";
import { TabBar } from "../../components/shell";

// Figma "Primary navigation": Discover, Bookings, Help, Account. Each tab screen draws its own brand header and title
// (components/shell.tsx); the tab bar keeps visible text labels, which are what screen readers announce.
export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: "Discover" }} />
      <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
      <Tabs.Screen name="help" options={{ title: "Help" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
