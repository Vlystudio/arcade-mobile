import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCart } from "../context/cart-context";
import { useLocation } from "../context/location-context";
import { reportError } from "../lib/report-error";
import { createSquareCheckoutLink } from "../../lib/square-food";

export default function FoodCartScreen() {
  const { items, updateQuantity, clearCart, total, itemCount } = useCart();
  const { location } = useLocation();

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasNonSquareItems = items.some((item) => !item.squareVariationId);
  const checkoutBlocked = items.length === 0 || hasNonSquareItems;
  const checkoutDisabled = placing || checkoutBlocked;

  async function handlePlaceOrder() {
    if (items.length === 0) return;
    setError(null);
    setPlacing(true);

    if (!location) {
      setPlacing(false);
      setError("Choose a location before placing your order.");
      return;
    }

    if (hasNonSquareItems) {
      setPlacing(false);
      setError("This cart has items that are not linked to Square yet. Refresh the menu and add Square catalog items before checkout.");
      return;
    }

    const localOrderId = createUuid();

    try {
      const checkout = await createSquareCheckoutLink({
        locationSlug: location.slug,
        localOrderId,
        items: items.map((item) => ({
          quantity: item.quantity,
          squareVariationId: item.squareVariationId!,
        })),
      });

      if (!checkout.checkoutUrl) {
        throw new Error("Square did not return a checkout URL.");
      }

      clearCart();
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(checkout.checkoutUrl);
      } else {
        await Linking.openURL(checkout.checkoutUrl);
      }
    } catch (squareError: any) {
      const msg = squareError?.message ?? "Square could not create a checkout page.";
      reportError("FoodCart.handlePlaceOrder", msg);
      setError(msg);
      setPlacing(false);
      return;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backIconBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/food" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Cart</Text>
          {location && (
            <Text style={[styles.headerLocation, { color: location.color }]}>{location.name}</Text>
          )}
        </View>
        {itemCount > 0 && (
          <View style={[styles.countBadge, location && { backgroundColor: location.color }]}>
            <Text style={styles.countBadgeText}>{itemCount}</Text>
          </View>
        )}
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="bag-outline" size={56} color="#2a2a2a" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySub}>Add items from the menu</Text>
          <Pressable style={styles.browseBtn} onPress={() => router.replace("/food" as any)}>
            <Ionicons name="restaurant-outline" size={16} color="#000" />
            <Text style={styles.browseBtnText}>Browse Menu</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Cart items */}
          <Text style={styles.sectionLabel}>Items</Text>
          {items.map((item) => (
            <View key={item.id} style={styles.cartItem}>
              <View style={styles.cartItemInfo}>
                <Text style={styles.cartItemName}>{item.name}</Text>
                <Text style={styles.cartItemPrice}>${(item.price * item.quantity).toFixed(2)}</Text>
              </View>
              <View style={styles.qtyRow}>
                <Pressable style={styles.qtyBtn} onPress={() => updateQuantity(item.id, item.quantity - 1)}>
                  <Ionicons name={item.quantity === 1 ? "trash-outline" : "remove"} size={16} color={item.quantity === 1 ? "#ef4444" : "#fff"} />
                </Pressable>
                <Text style={styles.qtyNum}>{item.quantity}</Text>
                <Pressable style={styles.qtyBtn} onPress={() => updateQuantity(item.id, item.quantity + 1)}>
                  <Ionicons name="add" size={16} color="#fff" />
                </Pressable>
                <Text style={styles.unitPrice}>${item.price.toFixed(2)} each</Text>
              </View>
            </View>
          ))}

          {/* Order summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Item subtotal</Text>
              <Text style={styles.summaryValue}>${total.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Taxes, tips, and fees</Text>
              <Text style={styles.summaryValueMuted}>Shown in Square</Text>
            </View>
            <Text style={styles.summaryNote}>Square calculates the final total using the restaurant catalog and checkout settings.</Text>
          </View>

          {hasNonSquareItems && (
            <View style={styles.warningBox}>
              <Ionicons name="information-circle-outline" size={15} color="#f59e0b" />
              <Text style={styles.warningText}>Checkout is available after these items are added from the live Square menu.</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Place order */}
          <Pressable
            style={[styles.placeBtn, checkoutBlocked && styles.placeBtnOff]}
            onPress={handlePlaceOrder}
            disabled={checkoutDisabled}
          >
            {placing
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="checkmark-circle-outline" size={20} color={checkoutBlocked ? "#555" : "#000"} />
            }
            <Text style={[styles.placeBtnText, checkoutBlocked && styles.placeBtnTextOff]}>{placing ? "Opening Square..." : "Continue to Square checkout"}</Text>
          </Pressable>

          <Pressable style={styles.clearBtn} onPress={() => clearCart()}>
            <Ionicons name="trash-outline" size={14} color="#ef4444" />
            <Text style={styles.clearBtnText}>Clear cart</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080808" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backIconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerLocation: { fontSize: 11, fontWeight: "700", marginTop: 1 },
  countBadge: {
    minWidth: 28, height: 28, borderRadius: 14,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 8,
  },
  countBadgeText: { color: "#000", fontWeight: "900", fontSize: 14 },

  content: { padding: 20, paddingBottom: 48 },

  sectionLabel: {
    color: "#777", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1.2,
    marginBottom: 12, marginTop: 8,
  },

  cartItem: {
    backgroundColor: "#111", borderRadius: 18, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: "#1e1e1e",
  },
  cartItemInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  cartItemName: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 },
  cartItemPrice: { color: "#06b6d4", fontSize: 15, fontWeight: "900" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  qtyBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  qtyNum: { color: "#fff", fontSize: 16, fontWeight: "900", minWidth: 32, textAlign: "center" },
  unitPrice: { color: "#777", fontSize: 12, marginLeft: 8 },

  inputCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginBottom: 20, overflow: "hidden",
  },
  inputRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  input: { flex: 1, color: "#fff", fontSize: 15 },
  notesInput: { minHeight: 60, textAlignVertical: "top" },
  inputDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1e1e1e", marginHorizontal: 16 },

  summaryCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 18, marginBottom: 20,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryLabel: { color: "#8a8a8a", fontSize: 14 },
  summaryValue: { color: "#fff", fontSize: 14, fontWeight: "700" },
  summaryValueMuted: { color: "#777", fontSize: 14, fontWeight: "700" },
  summaryNote: { color: "#8a8a8a", fontSize: 12, lineHeight: 18, marginTop: 4 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  warningBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  warningText: { color: "#f59e0b", fontSize: 13, flex: 1 },

  placeBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 18, marginBottom: 12,
  },
  placeBtnOff: { backgroundColor: "#141414" },
  placeBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  placeBtnTextOff: { color: "#8a8a8a" },

  clearBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12,
  },
  clearBtnText: { color: "#ef4444", fontSize: 13, fontWeight: "700" },

  // Empty cart
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 },
  emptySub: { color: "#777", fontSize: 14, marginBottom: 28 },
  browseBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  browseBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

});
