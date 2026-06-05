import * as Sentry from "@sentry/react-native";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

Sentry.init({
  dsn: "https://483f3f6bbb4581e28ed5ddaf6a17c07e@o4511509249785856.ingest.us.sentry.io/4511509250768896",
  sendDefaultPii: true,
  enableLogs: true,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],
});
import { AdminProvider } from "../context/admin-context";
import { AuthProvider } from "../context/auth-context";
import { CartProvider } from "../context/cart-context";
import { LocationProvider } from "../context/location-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
      <AdminProvider>
      <LocationProvider>
      <CartProvider>
      <ThemeProvider value={DarkTheme}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#000000" },
            headerTintColor: "#ffffff",
            headerTitleStyle: { fontWeight: "800", fontSize: 17 },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="signup" options={{ headerShown: false }} />
          <Stack.Screen name="games" options={{ headerShown: false }} />
          <Stack.Screen name="teams" options={{ headerShown: false }} />
          <Stack.Screen name="leagues" options={{ headerShown: false }} />
          <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ headerShown: false }} />
          <Stack.Screen name="chat" options={{ headerShown: false }} />
          <Stack.Screen name="chat-conversation" options={{ headerShown: false }} />
          <Stack.Screen name="team-detail" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen
            name="scan-lane"
            options={{ title: "Scan Lane", headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="submit-score"
            options={{ title: "Submit Score", headerBackTitle: "Back" }}
          />
          <Stack.Screen name="demo" options={{ headerShown: false }} />
          <Stack.Screen name="food" options={{ headerShown: false }} />
          <Stack.Screen name="food-cart" options={{ headerShown: false }} />
          <Stack.Screen name="tournaments" options={{ headerShown: false }} />
          <Stack.Screen name="trivia" options={{ headerShown: false }} />
          <Stack.Screen name="pool" options={{ headerShown: false }} />
          <Stack.Screen name="lane-scores" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="terms" options={{ headerShown: false }} />
          <Stack.Screen name="delete-account" options={{ headerShown: false }} />
          <Stack.Screen name="mfa-setup" options={{ headerShown: false }} />
          <Stack.Screen name="mfa-verify" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
          <Stack.Screen name="friends" options={{ headerShown: false }} />
          <Stack.Screen name="feedback" options={{ headerShown: false }} />
          <Stack.Screen name="support-chat" options={{ headerShown: false }} />
          <Stack.Screen name="ff-signup" options={{ headerShown: false }} />
          <Stack.Screen name="ff-tournament" options={{ headerShown: false }} />
          <Stack.Screen name="karaoke" options={{ headerShown: false }} />
          <Stack.Screen name="karaoke-display" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
      </CartProvider>
      </LocationProvider>
      </AdminProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
