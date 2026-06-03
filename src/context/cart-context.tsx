import React, { createContext, useContext, useState } from "react";
import { useLocation } from "./location-context";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  customizations: string[];
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
  total: number;
  itemCount: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { location } = useLocation();
  const [carts, setCarts] = useState<CartsByLocation>({
    arcade_bar: [],
    vinyl_hall: [],
  });

  const slug = (location?.slug ?? "arcade_bar") as keyof CartsByLocation;
  const items = carts[slug];

  function addItem(item: Omit<CartItem, "quantity">) {
    setCarts((prev) => {
      const current = prev[slug];
      const existing = current.find(
        (i) => i.id === item.id && JSON.stringify(i.customizations) === JSON.stringify(item.customizations)
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

  function clearCart() {
    setCarts((prev) => ({ ...prev, [slug]: [] }));
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, total, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
