// Authenticated API client for the native app. The bearer token goes only to EXPO_PUBLIC_API_URL (the Simply Sit API).
// Every call names the platform and app version so the server can refuse new bookings from an unsupported build (M6).
import Constants from "expo-constants";
import { Platform } from "react-native";
import { createSimplySitClient } from "@simply-sit/api-client";
import { currentAccessToken } from "./supabase";

export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? null;
export const appVersion = Constants.expoConfig?.version ?? "0.0.0";

export const api = apiUrl
  ? createSimplySitClient({ baseUrl: apiUrl, getAccessToken: currentAccessToken, clientVersion: `${Platform.OS}/${appVersion}` })
  : null;
