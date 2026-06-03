import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCart } from "../context/cart-context";
import { useLocation } from "../context/location-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

const TAX_RATE = 0.08;

export default function FoodCartScreen() {
  const { user } = useRequireAuth();
  const { items, updateQuantity, removeItem, clearCart, total, itemCount } = useCart();
  const { location } = useLocation();

  const [tableNumber, setTableNumber] = useState("");
  const [instructions, setInstructions] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tax = total * TAX_RATE;
  const grandTotal = total + tax;

  async function handlePlaceOrder() {
    if (!user || items.length === 0) return;
    setError(null);
    setPlacing(true);

    const { data, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: user.id,
        items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, customizations: i.customizations })),
        subtotal: total,
        tax,
        total: grandTotal,
        table_number: tableNumber.trim() || null,
        special_instructions: instructions.trim() || null,
        status: "pending",
      })
      .select("id")
      .single();

    setPlacing(false);

    if (orderError) {
      setError(orderError.message);
      return;
    }

    setOrderId(data.id);
    setPlaced(true);
    clearCart();
  }

  if (placed) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
          </View>
          <Text style={styles.successTitle}>Order Placed!</Text>
          <Text style={styles.successSub}>Your food is being prepared.</Text>
          {tableNumber ? (
            <View style={styles.tableChip}>
              <Ionicons name="location-outline" size={14} color="#06b6d4" />
              <Text style={styles.tableChipText}>Delivering to: {tableNumber}</Text>
            </View>
          ) : null}
          {orderId && (
            <Text style={styles.orderId}>Order #{orderId.slice(-6).toUpperCase()}</Text>
          )}
          <Pressable style={styles.backBtn} onPress={() => router.replace("/food" as any)}>
            <Text style={styles.backBtnText}>Back to Menu</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
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

          {/* Delivery info */}
          <Text style={styles.sectionLabel}>Delivery Info</Text>
          <View style={styles.inputCard}>
            <View style={styles.inputRow}>
              <Ionicons name="location-outline" size={16} color="#444" />
              <TextInput
                style={styles.input}
                placeholder="Table or lane number (e.g. Lane 4, Table 12)"
                placeholderTextColor="#333"
                value={tableNumber}
                onChangeText={setTableNumber}
                returnKeyType="next"
              />
            </View>
            <View style={styles.inputDivider} />
            <View style={styles.inputRow}>
              <Ionicons name="create-outline" size={16} color="#444" />
              <TextInput
                style={[styles.input, styles.notesInput]}
                placeholder="Special instructions (allergies, no onions, etc.)"
                placeholderTextColor="#333"
                value={instructions}
                onChangeText={setInstructions}
                multiline
                numberOfLines={3}
                maxLength={300}
              />
            </View>
          </View>

          {/* Order summary */}
          <Text style={styles.sectionLabel}>Summary</Text>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>${total.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tax (8%)</Text>
              <Text style={styles.summaryValue}>${tax.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>${grandTotal.toFixed(2)}</Text>
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Place order */}
          <Pressable
            style={[styles.placeBtn, (placing || items.length === 0) && styles.placeBtnOff]}
            onPress={handlePlaceOrder}
            disabled={placing || items.length === 0}
          >
            {placing
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="checkmark-circle-outline" size={20} color="#000" />
            }
            <Text style={styles.placeBtnText}>{placing ? "Placing order…" : `Place Order · $${grandTotal.toFixed(2)}`}</Text>
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
    color: "#444", fontSize: 11, fontWeight: "700",
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
  unitPrice: { color: "#444", fontSize: 12, marginLeft: 8 },

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
  summaryLabel: { color: "#555", fontSize: 14 },
  summaryValue: { color: "#fff", fontSize: 14, fontWeight: "700" },
  summaryDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2a2a2a", marginVertical: 8 },
  totalLabel: { color: "#fff", fontSize: 16, fontWeight: "900" },
  totalValue: { color: "#06b6d4", fontSize: 20, fontWeight: "900" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  placeBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 18, marginBottom: 12,
  },
  placeBtnOff: { backgroundColor: "#141414" },
  placeBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  clearBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12,
  },
  clearBtnText: { color: "#ef4444", fontSize: 13, fontWeight: "700" },

  // Empty cart
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8 },
  emptySub: { color: "#444", fontSize: 14, marginBottom: 28 },
  browseBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  browseBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  // Order success
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  successIcon: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center",
    marginBottom: 24,
  },
  successTitle: { color: "#fff", fontSize: 28, fontWeight: "900", marginBottom: 8 },
  successSub: { color: "#555", fontSize: 15, marginBottom: 20 },
  tableChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  tableChipText: { color: "#06b6d4", fontWeight: "700", fontSize: 14 },
  orderId: { color: "#333", fontSize: 13, marginBottom: 32, fontFamily: "monospace" },
  backBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18,
    paddingHorizontal: 32, paddingVertical: 16,
  },
  backBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
