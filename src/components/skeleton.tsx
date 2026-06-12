import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";

/** Pulsing placeholder block. */
export function Skeleton({ width, height = 14, radius = 8, style }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[{
        width: width ?? "100%",
        height,
        borderRadius: radius,
        backgroundColor: "#1c1c1c",
        opacity: pulse,
      }, style]}
    />
  );
}

/** Generic page skeleton: title + a stack of card placeholders. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={s.page}>
      <Skeleton width={160} height={28} radius={8} style={{ marginBottom: 8 }} />
      <Skeleton width={220} height={13} radius={6} style={{ marginBottom: 24 }} />
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.card}>
          <Skeleton width={44} height={44} radius={13} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={"55%"} height={14} />
            <Skeleton width={"35%"} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#000", paddingHorizontal: 20, paddingTop: 64 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#0d0d0d",
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#161616",
  },
});
