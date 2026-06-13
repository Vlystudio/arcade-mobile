import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
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

// Module-level badge cache (Teams = pending join requests for captained teams,
// Profile = unread DMs). TTL keeps it from refetching on every tab change.
type Badges = { "/teams": number; "/profile": number };
let cachedBadges: Badges = { "/teams": 0, "/profile": 0 };
let badgesFetchedAt = 0;
let badgesUserId: string | null = null;
const BADGE_TTL_MS = 60_000;
const badgeListeners = new Set<(b: Badges) => void>();

async function loadBadges(userId: string): Promise<Badges> {
  const out: Badges = { "/teams": 0, "/profile": 0 };
  try {
    const [captainRes, convRes] = await Promise.all([
      supabase.from("teams").select("id").eq("captain_user_id", userId),
      supabase
        .from("conversations")
        .select("id, last_message_at")
        .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
        .not("last_message_at", "is", null),
    ]);

    const captainIds = (captainRes.data ?? []).map((t: any) => t.id);
    if (captainIds.length) {
      const { count } = await supabase
        .from("team_requests")
        .select("id", { count: "exact", head: true })
        .in("team_id", captainIds)
        .eq("status", "pending")
        .eq("direction", "request");
      out["/teams"] = count ?? 0;
    }

    const convs = convRes.data ?? [];
    if (convs.length) {
      const reads = await Promise.all(
        convs.map((c: any) => AsyncStorage.getItem(`read_${c.id}`))
      );
      out["/profile"] = convs.filter((c: any, i: number) => {
        const lastRead = reads[i];
        return !lastRead || new Date(c.last_message_at) > new Date(lastRead);
      }).length;
    }
  } catch {}
  return out;
}

/** Force the badge cache to refresh on next render (e.g. after reading DMs). */
export function invalidateTabBadges() {
  badgesFetchedAt = 0;
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isAdmin } = useAdmin();
  const { user } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(cachedAvatarUrl ?? null);
  const [badges, setBadges] = useState<Badges>(cachedBadges);

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

  // Badges, with module-level TTL cache shared across screens
  useEffect(() => {
    const listener = (b: Badges) => setBadges({ ...b });
    badgeListeners.add(listener);

    if (
      user &&
      (Date.now() - badgesFetchedAt > BADGE_TTL_MS || badgesUserId !== user.id)
    ) {
      badgesFetchedAt = Date.now();
      badgesUserId = user.id;
      loadBadges(user.id).then((b) => {
        cachedBadges = b;
        badgeListeners.forEach((fn) => fn(b));
      });
    }
    return () => { badgeListeners.delete(listener); };
  }, [user?.id, pathname]);

  const tabs: Tab[] = isAdmin
    ? [...BASE_TABS.slice(0, BASE_TABS.length - 1), ADMIN_TAB, BASE_TABS[BASE_TABS.length - 1]]
    : BASE_TABS;

  const isWideWeb = Platform.OS === "web" && windowWidth >= 1100;
  // Monday = league night: pulse a LIVE dot on the Teams tab
  const isLeagueNight = new Date().getDay() === 1;

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

  function renderProfileIcon(active: boolean, size: number) {
    if (avatarUrl) {
      return (
        <View style={[styles.avatarRing, active && styles.avatarRingActive]}>
          <Image source={{ uri: avatarUrl }} style={styles.avatarIcon} contentFit="cover" />
        </View>
      );
    }
    if (user) {
      return (
        <View style={[styles.avatarRing, styles.avatarFallback, active && styles.avatarRingActive]}>
          <Text style={styles.avatarFallbackText}>
            {(user.email ?? "P")[0].toUpperCase()}
          </Text>
        </View>
      );
    }
    return <Ionicons name={active ? "person" : "person-outline"} size={size} color={active ? "#fff" : "#5a5a5a"} />;
  }

  // ── Desktop web: fixed left rail instead of a bottom bar ──
  if (isWideWeb) {
    return (
      <View style={styles.rail as any}>
        <View style={styles.railBrand}>
          <View style={styles.railBrandDot} />
          <Text style={styles.railBrandText}>Arcade</Text>
        </View>
        {tabs.map((tab) => {
          const active = pathname === tab.route;
          const isAdminTab = tab.route === "/admin";
          const isProfileTab = tab.route === "/profile";
          const badge = badges[tab.route as keyof Badges] ?? 0;
          return (
            <Pressable
              key={tab.route}
              style={({ pressed, hovered }: any) => [
                styles.railItem,
                active && styles.railItemActive,
                (pressed || hovered) && styles.railItemHover,
              ]}
              onPress={() => {
                if (pathname !== tab.route) router.replace(tab.route as any);
              }}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
            >
              <View>
                {isProfileTab ? (
                  renderProfileIcon(active, 22)
                ) : (
                  <Ionicons
                    name={active ? tab.iconActive : tab.icon}
                    size={22}
                    color={active ? (isAdminTab ? "#f59e0b" : "#fff") : "#777"}
                  />
                )}
                {tab.route === "/teams" && isLeagueNight && <View style={styles.liveDot} />}
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.railLabel,
                  active && styles.railLabelActive,
                  active && isAdminTab && { color: "#f59e0b" },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // ── Phone / narrow web: bottom bar ──
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
        const badge = badges[tab.route as keyof Badges] ?? 0;

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
            <View>
              {isProfileTab ? (
                renderProfileIcon(active, 24)
              ) : (
                <Ionicons
                  name={active ? tab.iconActive : tab.icon}
                  size={24}
                  color={active ? (isAdminTab ? "#f59e0b" : "#fff") : "#5a5a5a"}
                />
              )}
              {tab.route === "/teams" && isLeagueNight && <View style={styles.liveDot} />}
                {badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
                </View>
              )}
            </View>
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
    borderTopColor: "#1a1a1a",
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

  badge: {
    position: "absolute",
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: "#0a0a0a",
  },
  badgeText: { color: "#fff", fontSize: 9.5, fontWeight: "900" },
  liveDot: {
    position: "absolute", top: -3, left: -7,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444",
    borderWidth: 1.5, borderColor: "#0a0a0a",
  },

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

  // Desktop left rail (web ≥ 1100px)
  rail: {
    // @ts-ignore — web-only fixed positioning
    position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 200,
    backgroundColor: "#050505",
    borderRightWidth: 1,
    borderRightColor: "#161616",
    paddingTop: 22,
    paddingHorizontal: 12,
    gap: 4,
    zIndex: 50,
  },
  railBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
    paddingBottom: 18,
  },
  railBrandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#06b6d4" },
  railBrandText: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: 0.3 },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  railItemActive: { backgroundColor: "#101010" },
  railItemHover: { backgroundColor: "#0d0d0d" },
  railLabel: { color: "#888", fontSize: 14.5, fontWeight: "700" },
  railLabelActive: { color: "#fff" },
});
