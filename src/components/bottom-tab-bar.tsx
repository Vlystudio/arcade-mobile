import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdmin } from "../context/admin-context";

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

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.6 };

export default function BottomTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isAdmin } = useAdmin();
  const { width: windowWidth } = useWindowDimensions();

  const tabs: Tab[] = isAdmin
    ? [...BASE_TABS.slice(0, BASE_TABS.length - 1), ADMIN_TAB, BASE_TABS[BASE_TABS.length - 1]]
    : BASE_TABS;

  const activeIndex = tabs.findIndex((t) => t.route === pathname);
  const tabWidth = windowWidth / tabs.length;

  const pillX = useSharedValue(Math.max(activeIndex, 0) * tabWidth);

  useEffect(() => {
    const idx = tabs.findIndex((t) => t.route === pathname);
    if (idx >= 0) {
      pillX.value = withSpring(idx * tabWidth, SPRING_CONFIG);
    }
  }, [pathname, tabWidth, tabs.length]);

  const isAdminActive = pathname === "/admin";
  const pillColor = isAdminActive ? "rgba(245,158,11,0.18)" : "rgba(6,182,212,0.14)";

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {/* sliding active pill */}
      <Animated.View
        style={[
          styles.pill,
          { width: tabWidth, backgroundColor: pillColor },
          pillStyle,
        ]}
        pointerEvents="none"
      />

      {tabs.map((tab) => {
        const active = pathname === tab.route;
        const isAdminTab = tab.route === "/admin";
        return (
          <Pressable
            key={tab.route}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            onPress={() => {
              if (pathname !== tab.route) router.replace(tab.route as any);
            }}
          >
            <Ionicons
              name={active ? tab.iconActive : tab.icon}
              size={22}
              color={active ? (isAdminTab ? "#f59e0b" : "#06b6d4") : "#484848"}
            />
            <Text style={[
              styles.label,
              active && (isAdminTab ? styles.labelAdmin : styles.labelActive),
            ]}>
              {tab.label}
            </Text>
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
    borderTopColor: "#222",
    paddingTop: 6,
  },
  pill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 0,
  },
  tab: { flex: 1, alignItems: "center", gap: 3, paddingTop: 4, paddingBottom: 2 },
  tabPressed: { opacity: 0.45 },
  label:       { fontSize: 10, fontWeight: "500", color: "#484848" },
  labelActive: { color: "#06b6d4", fontWeight: "700" },
  labelAdmin:  { color: "#f59e0b", fontWeight: "700" },
});
