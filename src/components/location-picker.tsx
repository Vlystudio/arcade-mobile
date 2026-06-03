import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppLocation, LOCATIONS, useLocation } from "../context/location-context";

type Props = {
  compact?: boolean;
};

export function LocationPicker({ compact = false }: Props) {
  const { location, setLocation } = useLocation();

  if (compact && location) {
    return (
      <Pressable
        style={[styles.compactPill, { borderColor: location.color + "44", backgroundColor: location.accentColor }]}
        onPress={() => setLocation(location.slug === "arcade_bar" ? LOCATIONS[1] : LOCATIONS[0])}
      >
        <Ionicons name={location.icon as any} size={13} color={location.color} />
        <Text style={[styles.compactText, { color: location.color }]}>{location.shortName}</Text>
        <Ionicons name="swap-horizontal" size={11} color={location.color + "99"} />
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="location-outline" size={16} color="#555" />
        <Text style={styles.headerText}>Which location are you at?</Text>
      </View>
      <View style={styles.cards}>
        {LOCATIONS.map((loc) => {
          const active = location?.slug === loc.slug;
          return (
            <Pressable
              key={loc.slug}
              style={[styles.card, active && { borderColor: loc.color + "55", backgroundColor: loc.color + "0e" }]}
              onPress={() => setLocation(loc)}
            >
              <View style={[styles.iconCircle, { backgroundColor: loc.color + "18" }]}>
                <Ionicons name={loc.icon as any} size={24} color={loc.color} />
              </View>
              <Text style={[styles.cardName, active && { color: "#fff" }]}>{loc.name}</Text>
              <Text style={styles.cardTagline}>{loc.tagline}</Text>
              {active && (
                <View style={[styles.activeDot, { backgroundColor: loc.color }]} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  headerText: { color: "#555", fontSize: 13, fontWeight: "700" },

  cards: { flexDirection: "row", gap: 10 },
  card: {
    flex: 1, backgroundColor: "#0d0d0d",
    borderRadius: 20, padding: 16, alignItems: "center", gap: 8,
    borderWidth: 1.5, borderColor: "#1e1e1e",
  },
  iconCircle: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  cardName: { color: "#888", fontSize: 14, fontWeight: "900", textAlign: "center" },
  cardTagline: { color: "#333", fontSize: 11, textAlign: "center", lineHeight: 15 },
  activeDot: {
    position: "absolute", top: 10, right: 10,
    width: 8, height: 8, borderRadius: 4,
  },

  compactPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1,
  },
  compactText: { fontSize: 12, fontWeight: "800" },
});
