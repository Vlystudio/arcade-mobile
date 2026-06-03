import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  uri?: string | null;
  name: string;
  size: number;
  radius?: number;
};

export function Avatar({ uri, name, size, radius }: Props) {
  const br = radius ?? size / 2;
  const fs = Math.round(size * 0.38);
  const initial = (name || "?")[0].toUpperCase();
  const shape = { width: size, height: size, borderRadius: br };

  if (uri) {
    return <Image source={{ uri }} style={shape} contentFit="cover" />;
  }
  return (
    <View style={[styles.fallback, shape]}>
      <Text style={[styles.text, { fontSize: fs }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "800" },
});
