import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AdminProvider } from "../context/admin-context";
import { CartProvider } from "../context/cart-context";
import { LocationProvider } from "../context/location-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
          <Stack.Screen name="pool" options={{ headerShown: false }} />
          <Stack.Screen name="lane-scores" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
      </CartProvider>
      </LocationProvider>
      </AdminProvider>
    </SafeAreaProvider>
  );
}
