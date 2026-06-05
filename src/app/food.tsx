import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { LocationPicker } from "../components/location-picker";
import { useCart } from "../context/cart-context";
import { useLocation } from "../context/location-context";
import { useAuth } from "../context/auth-context";
import { fetchSquareMenu } from "../../lib/square-food";
import { supabase } from "../../lib/supabase";

type MenuItem = {
  id: string;
  source?: "supabase" | "square";
  squareVariationId?: string;
  squareItemId?: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  ingredients: string[];
  photo_url: string | null;
  available: boolean;
};

const CATEGORIES = [
  { key: "all", label: "All", icon: "grid-outline" },
  { key: "appetizers", label: "Starters", icon: "leaf-outline" },
  { key: "mains", label: "Mains", icon: "restaurant-outline" },
  { key: "burgers", label: "Burgers", icon: "fast-food-outline" },
  { key: "pizza", label: "Pizza", icon: "pizza-outline" },
  { key: "drinks", label: "Drinks", icon: "beer-outline" },
  { key: "desserts", label: "Desserts", icon: "ice-cream-outline" },
] as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map((category) => [category.key, category.label]));

const CATEGORY_COLORS: Record<string, string> = {
  appetizers: "#22c55e",
  mains: "#f59e0b",
  burgers: "#ef4444",
  pizza: "#f97316",
  drinks: "#06b6d4",
  desserts: "#a855f7",
};

export default function FoodScreen() {
  const { loading: authLoading } = useAuth();
  const { addItem, itemCount } = useCart();
  const { location, isVinyl } = useLocation();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [locSwitcherVisible, setLocSwitcherVisible] = useState(false);

  async function loadMenu() {
    if (location) {
      try {
        const squareMenu = await fetchSquareMenu(location.slug);
        if (squareMenu.configured && squareMenu.items.length > 0) {
          setMenuItems(squareMenu.items);
          setLoading(false);
          setRefreshing(false);
          return;
        }
      } catch (squareError) {
        console.warn("[food] Square menu unavailable, falling back to Supabase.", squareError);
      }
    }

    let query = supabase
      .from("menu_items")
      .select("id, name, description, price, category, ingredients, photo_url, available")
      .eq("available", true)
      .order("category")
      .order("name");

    if (location) {
      query = query.or(`location_slug.eq.${location.slug},location_slug.is.null`);
    }

    const { data, error } = await query;
    if (!error) setMenuItems(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadMenu(); }, [location]);
  useFocusEffect(useCallback(() => { loadMenu(); }, [location]));

  useEffect(() => {
    if (locSwitcherVisible) setLocSwitcherVisible(false);
    setActiveCategory("all");
  }, [location]);

  function handleAddToCart(item: MenuItem) {
    addItem({
      id: item.id,
      name: item.name,
      price: item.price,
      customizations: [],
      source: item.source ?? "supabase",
      squareVariationId: item.squareVariationId,
      squareItemId: item.squareItemId,
    });
    setAddedId(item.id);
    setTimeout(() => setAddedId(null), 1200);
    setSelectedItem(null);
  }

  const filtered = menuItems.filter((item) => {
    const matchCat = activeCategory === "all" || item.category === activeCategory;
    const matchSearch = !searchText.trim() || item.name.toLowerCase().includes(searchText.toLowerCase()) || item.description?.toLowerCase().includes(searchText.toLowerCase());
    return matchCat && matchSearch;
  });

  const grouped = filtered.reduce<Record<string, MenuItem[]>>((acc, item) => {
    const cat = item.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const categoryOptions = [
    CATEGORIES[0],
    ...CATEGORIES.slice(1).filter((category) => menuItems.some((item) => item.category === category.key)),
    ...Array.from(new Set(menuItems.map((item) => item.category)))
      .filter((category) => category && !CATEGORY_LABELS[category])
      .map((category) => ({ key: category, label: titleCase(category), icon: "restaurant-outline" })),
  ];

  if (authLoading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  if (!location) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.gateWrap}>
            <View style={styles.gateIconCircle}>
              <Ionicons name="restaurant-outline" size={36} color="#06b6d4" />
            </View>
            <Text style={styles.gateTitle}>Where are you ordering from?</Text>
            <Text style={styles.gateSub}>Choose your location to see the menu</Text>
            <LocationPicker />
          </View>
        </SafeAreaView>
        <BottomTabBar />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMenu(); }} tintColor="#06b6d4" />}
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.pageTitle}>{isVinyl ? "Kitchen" : "Food"}</Text>
                <Text style={styles.pageSub}>{isVinyl ? "Full kitchen menu" : "Order to your lane"}</Text>
              </View>
              <Pressable style={styles.cartBtn} onPress={() => router.push("/food-cart" as any)}>
                <Ionicons name="bag-outline" size={22} color="#fff" />
                {itemCount > 0 && (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>{itemCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>

            {/* Location switcher banner */}
            <Pressable
              style={[styles.locBanner, { borderColor: location.color + "40", backgroundColor: location.accentColor }]}
              onPress={() => setLocSwitcherVisible(true)}
            >
              <Ionicons name={location.icon as any} size={15} color={location.color} />
              <Text style={[styles.locBannerName, { color: location.color }]}>{location.name}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.locBannerChange}>Change location</Text>
              <Ionicons name="chevron-forward" size={13} color={location.color + "99"} />
            </Pressable>

            {/* Search */}
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search menu…"
                placeholderTextColor="#333"
                value={searchText}
                onChangeText={setSearchText}
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => setSearchText("")}>
                  <Ionicons name="close-circle" size={16} color="#444" />
                </Pressable>
              )}
            </View>

            {/* Category pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsScroll} contentContainerStyle={styles.pillsContent}>
              {categoryOptions.map((cat) => {
                const active = activeCategory === cat.key;
                const color = CATEGORY_COLORS[cat.key] ?? "#06b6d4";
                return (
                  <Pressable
                    key={cat.key}
                    style={[styles.pill, active && { backgroundColor: color + "22", borderColor: color + "55" }]}
                    onPress={() => setActiveCategory(cat.key)}
                  >
                    <Ionicons name={cat.icon as any} size={14} color={active ? color : "#555"} />
                    <Text style={[styles.pillText, active && { color }]}>{cat.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Menu */}
            {loading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="restaurant-outline" size={48} color="#2a2a2a" style={{ marginBottom: 12 }} />
                <Text style={styles.emptyTitle}>
                  {menuItems.length === 0 ? "Menu coming soon" : "No items found"}
                </Text>
                <Text style={styles.emptySub}>
                  {menuItems.length === 0
                    ? "Add items in Supabase to get started."
                    : "Try a different category or search."}
                </Text>
              </View>
            ) : (
              activeCategory === "all" ? (
                Object.entries(grouped).map(([cat, items]) => (
                  <View key={cat}>
                    <CategoryLabel cat={cat} />
                    {items.map((item) => (
                      <MenuCard
                        key={item.id}
                        item={item}
                        justAdded={addedId === item.id}
                        onPress={() => setSelectedItem(item)}
                        onAdd={() => handleAddToCart(item)}
                      />
                    ))}
                  </View>
                ))
              ) : (
                filtered.map((item) => (
                  <MenuCard
                    key={item.id}
                    item={item}
                    justAdded={addedId === item.id}
                    onPress={() => setSelectedItem(item)}
                    onAdd={() => handleAddToCart(item)}
                  />
                ))
              )
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* Location switcher modal */}
      <Modal visible={locSwitcherVisible} transparent animationType="slide" onRequestClose={() => setLocSwitcherVisible(false)}>
        <View style={styles.locModalBg}>
          <Pressable style={styles.locModalDismiss} onPress={() => setLocSwitcherVisible(false)} />
          <View style={styles.locModalSheet}>
            <View style={styles.locModalHandle} />
            <Text style={styles.locModalTitle}>Switch Location</Text>
            <Text style={styles.locModalSub}>Your cart is saved separately for each location.</Text>
            <LocationPicker />
            <Pressable style={styles.locModalDoneBtn} onPress={() => setLocSwitcherVisible(false)}>
              <Text style={styles.locModalDoneBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Item detail sheet */}
      <Modal visible={!!selectedItem} transparent animationType="slide" onRequestClose={() => setSelectedItem(null)}>
        <View style={styles.sheetBg}>
          <Pressable style={styles.sheetDismiss} onPress={() => setSelectedItem(null)} />
          {selectedItem && (
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />

              {/* Photo or placeholder */}
              {selectedItem.photo_url ? (
                <Image source={{ uri: selectedItem.photo_url }} style={styles.sheetPhoto} contentFit="cover" />
              ) : (
                <View style={[styles.sheetPhotoPlaceholder, { backgroundColor: (CATEGORY_COLORS[selectedItem.category] ?? "#06b6d4") + "18" }]}>
                  <Ionicons name="fast-food-outline" size={40} color={CATEGORY_COLORS[selectedItem.category] ?? "#06b6d4"} />
                </View>
              )}

              <View style={styles.sheetBody}>
                <View style={styles.sheetTitleRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.sheetCatRow}>
                      <View style={[styles.sheetCatBadge, { backgroundColor: (CATEGORY_COLORS[selectedItem.category] ?? "#06b6d4") + "22" }]}>
                        <Text style={[styles.sheetCatText, { color: CATEGORY_COLORS[selectedItem.category] ?? "#06b6d4" }]}>
                          {selectedItem.category}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.sheetName}>{selectedItem.name}</Text>
                  </View>
                  <Text style={styles.sheetPrice}>${selectedItem.price.toFixed(2)}</Text>
                </View>

                {selectedItem.description && (
                  <Text style={styles.sheetDesc}>{selectedItem.description}</Text>
                )}

                {selectedItem.ingredients.length > 0 && (
                  <>
                    <Text style={styles.sheetSectionLabel}>Ingredients</Text>
                    <View style={styles.ingredientsList}>
                      {selectedItem.ingredients.map((ing, i) => (
                        <View key={i} style={styles.ingredientChip}>
                          <Text style={styles.ingredientText}>{ing}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                <Pressable
                  style={[styles.addToCartBtn, addedId === selectedItem.id && styles.addToCartBtnDone]}
                  onPress={() => handleAddToCart(selectedItem)}
                >
                  <Ionicons name={addedId === selectedItem.id ? "checkmark" : "bag-add-outline"} size={20} color="#000" />
                  <Text style={styles.addToCartBtnText}>
                    {addedId === selectedItem.id ? "Added!" : `Add to Cart — $${selectedItem.price.toFixed(2)}`}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function CategoryLabel({ cat }: { cat: string }) {
  const color = CATEGORY_COLORS[cat] ?? "#06b6d4";
  const label = CATEGORIES.find((c) => c.key === cat)?.label ?? titleCase(cat);
  return (
    <View style={styles.catLabelRow}>
      <View style={[styles.catLabelDot, { backgroundColor: color }]} />
      <Text style={[styles.catLabel, { color }]}>{label}</Text>
    </View>
  );
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function MenuCard({ item, justAdded, onPress, onAdd }: {
  item: MenuItem;
  justAdded: boolean;
  onPress: () => void;
  onAdd: () => void;
}) {
  const color = CATEGORY_COLORS[item.category] ?? "#06b6d4";
  return (
    <Pressable style={styles.card} onPress={onPress}>
      {item.photo_url ? (
        <Image source={{ uri: item.photo_url }} style={styles.cardPhoto} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.cardPhotoPlaceholder, { backgroundColor: color + "15" }]}>
          <Ionicons name="fast-food-outline" size={24} color={color} />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        {item.description && (
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
        )}
        <Text style={styles.cardPrice}>${item.price.toFixed(2)}</Text>
      </View>
      <Pressable
        style={[styles.addBtn, justAdded && styles.addBtnDone]}
        onPress={(e) => { e.stopPropagation(); onAdd(); }}
      >
        <Ionicons name={justAdded ? "checkmark" : "add"} size={20} color="#000" />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },
  pageSub: { color: "#555", fontSize: 14 },
  cartBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  cartBadge: {
    position: "absolute", top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 2, borderColor: "#000",
  },
  cartBadgeText: { color: "#000", fontSize: 10, fontWeight: "900" },

  // Location gate (no location selected)
  gateWrap: { flex: 1, paddingHorizontal: 28, paddingTop: 60, gap: 12 },
  gateIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  gateTitle: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.3, marginBottom: 4 },
  gateSub: { color: "#555", fontSize: 14, lineHeight: 20, marginBottom: 20 },

  // Location banner
  locBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, marginBottom: 16,
  },
  locBannerName: { fontSize: 13, fontWeight: "800" },
  locBannerChange: { color: "#555", fontSize: 12, fontWeight: "600" },

  // Location switcher modal
  locModalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  locModalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  locModalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: "#222",
  },
  locModalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 24 },
  locModalTitle: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: -0.3, marginBottom: 4 },
  locModalSub: { color: "#555", fontSize: 13, marginBottom: 20 },
  locModalDoneBtn: {
    backgroundColor: "#1a1a1a", borderRadius: 16, paddingVertical: 16,
    alignItems: "center", marginTop: 8, borderWidth: 1, borderColor: "#222",
  },
  locModalDoneBtnText: { color: "#888", fontWeight: "700", fontSize: 15 },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0d0d0d", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 16,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },

  pillsScroll: { marginBottom: 20 },
  pillsContent: { gap: 8, paddingRight: 4 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#0d0d0d", borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  pillText: { color: "#555", fontSize: 13, fontWeight: "600" },

  catLabelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, marginTop: 8 },
  catLabelDot: { width: 6, height: 6, borderRadius: 3 },
  catLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2 },

  card: {
    backgroundColor: "#111", borderRadius: 18, flexDirection: "row",
    alignItems: "center", gap: 14, marginBottom: 10, padding: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  cardPhoto: { width: 72, height: 72, borderRadius: 14 },
  cardPhotoPlaceholder: {
    width: 72, height: 72, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardName: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 3 },
  cardDesc: { color: "#555", fontSize: 13, lineHeight: 18, marginBottom: 6 },
  cardPrice: { color: "#06b6d4", fontSize: 15, fontWeight: "900" },
  addBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  addBtnDone: { backgroundColor: "#22c55e" },

  emptyState: { alignItems: "center", paddingTop: 60, paddingBottom: 40 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 8 },
  emptySub: { color: "#444", fontSize: 14, textAlign: "center", lineHeight: 20 },

  // Item detail sheet
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  sheetDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderTopWidth: 1, borderColor: "#1e1e1e", overflow: "hidden",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginTop: 12, marginBottom: 0, position: "absolute", top: 0, zIndex: 1 },
  sheetPhoto: { width: "100%", height: 220 },
  sheetPhotoPlaceholder: {
    width: "100%", height: 160,
    alignItems: "center", justifyContent: "center",
    marginTop: 16,
  },
  sheetBody: { padding: 24, paddingTop: 20 },
  sheetTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  sheetCatRow: { marginBottom: 6 },
  sheetCatBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  sheetCatText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  sheetName: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  sheetPrice: { color: "#06b6d4", fontSize: 24, fontWeight: "900" },
  sheetDesc: { color: "#888", fontSize: 14, lineHeight: 21, marginBottom: 20 },
  sheetSectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 10,
  },
  ingredientsList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  ingredientChip: {
    backgroundColor: "#1a1a1a", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  ingredientText: { color: "#888", fontSize: 13 },
  addToCartBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 18, marginBottom: 8,
  },
  addToCartBtnDone: { backgroundColor: "#22c55e" },
  addToCartBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
