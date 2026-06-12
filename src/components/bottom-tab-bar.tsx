import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdmin } from "../context/admin-context";
import { useAuth } from "../context/auth-context";
import { supabase } from "../../lib/supabase";

type Tab = {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconActive: React.ComponentProps<typeof Ionicons>["name"];
  route: string;
};

const BASE_TABS: Tab[] = [
  { label: "Feed",     icon: "home-outline",            iconActive: "home",            route: "/" },
  { label: "Games",    icon: "game-controller-outline", iconActive: "game-controller", route: "/games" },
  { label: "Trivia",   icon: "help-circle-outline",     iconActive: "help-circle",     route: "/trivia" },
  { label: "Teams",    icon: "people-outline",          iconActive: "people",          route: "/teams" },
  { label: "Food",     icon: "restaurant-outline",      iconActive: "restaurant",      route: "/food" },
  { label: "Profile",  icon: "person-outline",          iconActive: "person",          route: "/profile" },
];

const ADMIN_TAB: Tab = {
  label: "Admin",
  icon: "shield-outline",
  iconActive: "shield",
  route: "/admin",
};

const SPRING_CONFIG = { damping: 20, stiffness: 220, mass: 0.55 };

// Module-level avatar cache so the tab bar doesn't refetch on every screen change.
// undefined = not fetched yet, null = fetched but user has no avatar.
let cachedAvatarUrl: string | null | undefined;
let cachedAvatarUserId: string | null = null;
const avatarListeners = new Set<(url: string | null) => void>();

export function setTabBarAvatar(url: string | null) {
  cachedAvatarUrl = url;
  avatarListeners.forEach((fn) => fn(url));
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isAdmin } = useAdmin();
  const { user } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cachedAvatarUrl ?? null);

  // Fetch the avatar once per session (module cache survives screen changes)
  useEffect(() => {
    const listener = (url: string | null) => setAvatarUrl(url);
    avatarListeners.add(listener);

    if (user && (cachedAvatarUrl === undefined || cachedAvatarUserId !== user.id)) {
      cachedAvatarUserId = user.id;
      supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          setTabBarAvatar(data?.avatar_url ?? null);
        });
    }
    return () => { avatarListeners.delete(listener); };
  }, [user?.id]);

  const tabs: Tab[] = isAdmin
    ? [...BASE_TABS.slice(0, BASE_TABS.length - 1), ADMIN_TAB, BASE_TABS[BASE_TABS.length - 1]]
    : BASE_TABS;

  const activeIndex = tabs.findIndex((t) => t.route === pathname);
  const tabWidth = windowWidth / tabs.length;

  // Animated dot indicator under the active tab
  const dotX = useSharedValue(Math.max(activeIndex, 0) * tabWidth + tabWidth / 2 - 2);

  useEffect(() => {
    const idx = tabs.findIndex((t) => t.route === pathname);
    if (idx >= 0) {
      dotX.value = withSpring(idx * tabWidth + tabWidth / 2 - 2, SPRING_CONFIG);
    }
  }, [pathname, tabWidth, tabs.length]);

  const isAdminActive = pathname === "/admin";

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dotX.value }],
  }));

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {/* animated active-tab dot */}
      {activeIndex >= 0 && (
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: isAdminActive ? "#f59e0b" : "#06b6d4" },
            dotStyle,
          ]}
          pointerEvents="none"
        />
      )}

      {tabs.map((tab) => {
        const active = pathname === tab.route;
        const isAdminTab = tab.route === "/admin";
        const isProfileTab = tab.route === "/profile";

        return (
          <Pressable
            key={tab.route}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            onPress={() => {
              if (pathname !== tab.route) router.replace(tab.route as any);
            }}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
          >
            {isProfileTab && avatarUrl ? (
              <View style={[styles.avatarRing, active && styles.avatarRingActive]}>
                <Image source={{ uri: avatarUrl }} style={styles.avatarIcon} contentFit="cover" />
              </View>
            ) : isProfileTab && user ? (
              <View style={[styles.avatarRing, styles.avatarFallback, active && styles.avatarRingActive]}>
                <Text style={styles.avatarFallbackText}>
                  {(user.email ?? "P")[0].toUpperCase()}
                </Text>
              </View>
            ) : (
              <Ionicons
                name={active ? tab.iconActive : tab.icon}
                size={24}
                color={active ? (isAdminTab ? "#f59e0b" : "#fff") : "#5a5a5a"}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#0a0a0a",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1e1e1e",
    paddingTop: 10,
  },
  dot: {
    position: "absolute",
    top: 2,
    left: 0,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 4 },
  tabPressed: { opacity: 0.45 },

  avatarRing: {
    width: 27,
    height: 27,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarRingActive: { borderColor: "#fff" },
  avatarIcon: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { backgroundColor: "#06b6d4" },
  avatarFallbackText: { color: "#000", fontSize: 11, fontWeight: "900" },
});
