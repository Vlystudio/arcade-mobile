import { useRef, type ReactNode } from "react";
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

/**
 * Pressable with native-feeling spring scale feedback (0.96 on press-in).
 * Drop-in replacement for Pressable on buttons/cards.
 */
export function PressableScale({ style, children, ...rest }: Omit<PressableProps, "children" | "style"> & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
        rest.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
