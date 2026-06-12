import * as Sentry from "@sentry/react-native";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, usePathname } from "expo-router";
import React from "react";
import { Platform, View } from "react-native";
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
import { AuthProvider, useAuth } from "../context/auth-context";
import { CartProvider } from "../context/cart-context";
import { LocationProvider } from "../context/location-context";
import { EnvBanner } from "../components/env-banner";
import { ScreenshotButton } from "../components/screenshot-button";
import { configureNotificationHandler, registerForPush } from "../lib/push";
import { ToastHost } from "../components/toast";
import { UpdateBanner } from "../components/update-banner";

configureNotificationHandler();

// Web: full-bleed routes (TV/dashboard use-cases) and wide dashboard routes.
// Everything else renders in a centered phone-style column like IG/X web.
const WEB_FULL_ROUTES = new Set(["/skeeball-live", "/karaoke-display", "/demo"]);
const WEB_WIDE_ROUTES = new Set(["/admin", "/owner", "/architect"]);

/** Centers the whole app in a column on desktop web; no-op on native. */
function AppColumn({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (Platform.OS !== "web") return <>{children}</>;
  if (WEB_FULL_ROUTES.has(pathname)) return <>{children}</>;
  const maxWidth = WEB_WIDE_ROUTES.has(pathname) ? 1140 : 680;
  return (
    <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center" }}>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: "#161616",
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Registers the device for push once a user is signed in. Renders nothing. */
function PushRegistrar() {
  const { user } = useAuth();
  React.useEffect(() => {
    if (user) registerForPush(user.id);
  }, [user?.id]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
      <AdminProvider>
      <LocationProvider>
      <CartProvider>
      <ThemeProvider value={DarkTheme}>
        <AppColumn>
        <EnvBanner />
        <UpdateBanner />
        <PushRegistrar />
        <ScreenshotButton />
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
          <Stack.Screen name="skeeball-tracker" options={{ headerShown: false }} />
          <Stack.Screen name="demo" options={{ headerShown: false }} />
          <Stack.Screen name="food" options={{ headerShown: false }} />
          <Stack.Screen name="food-cart" options={{ headerShown: false }} />
          <Stack.Screen name="tournaments" options={{ headerShown: false }} />
          <Stack.Screen name="trivia" options={{ headerShown: false }} />
          <Stack.Screen name="trivia-join" options={{ headerShown: false }} />
          <Stack.Screen name="pool" options={{ headerShown: false }} />
          <Stack.Screen name="lane-scores" options={{ headerShown: false }} />
          <Stack.Screen name="privacy" options={{ headerShown: false }} />
          <Stack.Screen name="terms" options={{ headerShown: false }} />
          <Stack.Screen name="delete-account" options={{ headerShown: false }} />
          <Stack.Screen name="mfa-setup" options={{ headerShown: false }} />
          <Stack.Screen name="mfa-verify" options={{ headerShown: false }} />
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
          <Stack.Screen name="team-registration" options={{ headerShown: false }} />
          <Stack.Screen name="friends" options={{ headerShown: false }} />
          <Stack.Screen name="feedback" options={{ headerShown: false }} />
          <Stack.Screen name="support-chat" options={{ headerShown: false }} />
          <Stack.Screen name="ff-signup" options={{ headerShown: false }} />
          <Stack.Screen name="ff-tournament" options={{ headerShown: false }} />
          <Stack.Screen name="karaoke" options={{ headerShown: false }} />
          <Stack.Screen name="karaoke-display" options={{ headerShown: false }} />
          <Stack.Screen name="forums" options={{ headerShown: false }} />
          <Stack.Screen name="forum-detail" options={{ headerShown: false }} />
          <Stack.Screen name="user-profile" options={{ headerShown: false }} />
          <Stack.Screen name="team-chat" options={{ headerShown: false }} />
          <Stack.Screen name="owner" options={{ headerShown: false }} />
          <Stack.Screen name="architect" options={{ headerShown: false }} />
          <Stack.Screen name="skeeball-compare" options={{ headerShown: false }} />
          <Stack.Screen name="skeeball-live" options={{ headerShown: false }} />
          <Stack.Screen name="skeeball-schedule" options={{ headerShown: false }} />
          <Stack.Screen name="guidelines" options={{ headerShown: false }} />
          <Stack.Screen name="hall-of-fame" options={{ headerShown: false }} />
          <Stack.Screen name="my-games" options={{ headerShown: false }} />
          <Stack.Screen name="events" options={{ headerShown: false }} />
          <Stack.Screen name="saved-posts" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: false }} />
          <Stack.Screen name="fantasy" options={{ headerShown: false }} />
          <Stack.Screen name="beta-feedback" options={{ headerShown: false }} />
        </Stack>
        <ToastHost />
        </AppColumn>
      </ThemeProvider>
      </CartProvider>
      </LocationProvider>
      </AdminProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
