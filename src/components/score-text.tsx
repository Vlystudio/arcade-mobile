import { useFonts } from "expo-font";
import { useEffect, useRef, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

/**
 * Arcade-style numerals for scores. Uses Chakra Petch Bold (OFL) once
 * loaded; falls back to the system font seamlessly. `animate` counts the
 * value up on mount/changes (450ms) for that ticker feel.
 */
export function ScoreText({
  value,
  style,
  animate = false,
  prefix = "",
  suffix = "",
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  animate?: boolean;
  prefix?: string;
  suffix?: string;
}) {
  const [fontsLoaded] = useFonts({
    "ChakraPetch-Bold": require("../../assets/fonts/ChakraPetch-Bold.ttf"),
  });
  const [display, setDisplay] = useState(animate ? 0 : value);
  const raf = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!animate) { setDisplay(value); return; }
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const t0 = Date.now();
    const DURATION = 450;
    if (raf.current) clearInterval(raf.current);
    raf.current = setInterval(() => {
      const p = Math.min((Date.now() - t0) / DURATION, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + diff * eased));
      if (p >= 1 && raf.current) { clearInterval(raf.current); raf.current = null; }
    }, 16);
    return () => { if (raf.current) clearInterval(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animate]);

  return (
    <Text style={[fontsLoaded && { fontFamily: "ChakraPetch-Bold" }, style]}>
      {prefix}{display.toLocaleString()}{suffix}
    </Text>
  );
}
