import AsyncStorage from "@react-native-async-storage/async-storage";
export type PendingCheckout = { fingerprint: string; localOrderId: string; checkoutUrl?: string; squareOrderId?: string };
const key = (scope: string) => "@arcade:checkout:" + scope;
export function checkoutFingerprint(location: string, items: { squareVariationId?: string; quantity: number }[]) {
  return JSON.stringify([location, items.map((item) => [item.squareVariationId, item.quantity])]);
}
export async function readCheckout(scope: string): Promise<PendingCheckout | null> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw ? JSON.parse(raw) : null;
}
export function saveCheckout(scope: string, value: PendingCheckout) {
  return AsyncStorage.setItem(key(scope), JSON.stringify(value));
}
export function removeCheckout(scope: string) { return AsyncStorage.removeItem(key(scope)); }
