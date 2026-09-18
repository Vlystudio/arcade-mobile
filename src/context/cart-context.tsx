import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./auth-context";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation } from "./location-context";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  customizations: string[];
  source?: "supabase" | "square";
  squareVariationId?: string;
  squareItemId?: string;
};

type CartsByLocation = {
  arcade_bar: CartItem[];
  vinyl_hall: CartItem[];
};

type CartContextType = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  clearCart: () => void;
  ready: boolean;
  persistCart: () => Promise<void>;
  total: number;
  itemCount: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const scope = user?.id ?? "guest";
  return <CartStateProvider key={scope} scope={scope}>{children}</CartStateProvider>;
}
function CartStateProvider({ children, scope }: { children: React.ReactNode; scope: string }) {
  const { location } = useLocation();
  const [carts, setCarts] = useState<CartsByLocation>({
    arcade_bar: [],
    vinyl_hall: [],
  });

  const [ready, setReady] = useState(false);
  const storageKey = `@arcade:carts:${scope}`;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (!active) return;
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.arcade_bar) && Array.isArray(saved.vinyl_hall)) setCarts(saved);
      }
      setReady(true);
    }).catch(console.warn);
    return () => { active = false; };
  }, [storageKey]);
  useEffect(() => {
    if (ready) AsyncStorage.setItem(storageKey, JSON.stringify(carts)).catch(console.warn);
  }, [carts, ready, storageKey]);
  const persistCart = () => AsyncStorage.setItem(storageKey, JSON.stringify(carts));

  const slug = (location?.slug ?? "arcade_bar") as keyof CartsByLocation;
  const items = carts[slug];

  function addItem(item: Omit<CartItem, "quantity">) {
    setCarts((prev) => {
      const current = prev[slug];
      const existing = current.find(
        (i) =>
          i.id === item.id &&
          i.squareVariationId === item.squareVariationId &&
          JSON.stringify(i.customizations) === JSON.stringify(item.customizations)
      );
      if (existing) {
        return { ...prev, [slug]: current.map((i) => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i) };
      }
      return { ...prev, [slug]: [...current, { ...item, quantity: 1 }] };
    });
  }

  function removeItem(id: string) {
    setCarts((prev) => ({ ...prev, [slug]: prev[slug].filter((i) => i.id !== id) }));
  }

  function updateQuantity(id: string, qty: number) {
    if (qty <= 0) { removeItem(id); return; }
    setCarts((prev) => ({ ...prev, [slug]: prev[slug].map((i) => i.id === id ? { ...i, quantity: qty } : i) }));
  }

  const clearCart = useCallback(() => {
    setCarts((prev) => ({ ...prev, [slug]: [] }));
  }, [slug]);

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, ready, persistCart, total, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
