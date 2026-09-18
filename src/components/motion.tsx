import { useIsFocused } from "@react-navigation/native";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "../context/motion-context";

export const MOTION = {
  press: 90,
  release: 160,
  screen: 180,
  enter: 240,
  exit: 160,
  easeOut: Easing.out(Easing.cubic),
  easeIn: Easing.in(Easing.cubic),
  nativeDriver: Platform.OS !== "web",
};

/** Animate content changes without remounting children or resetting form state. */
export function MotionView({ children, transitionKey, active = true, distance = 8, style }: {
  children: ReactNode;
  transitionKey?: string;
  active?: boolean;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;

  useLayoutEffect(() => {
    progress.stopAnimation();
    if (reducedMotion || !active) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: MOTION.screen, easing: MOTION.easeOut,
      useNativeDriver: MOTION.nativeDriver, isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, progress, reducedMotion, transitionKey]);

  return (
    <Animated.View style={[style, { opacity: progress }, distance !== 0 && {
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

/** Native navigation owns its transition; web gets a brief fade on focus. */
export function RouteTransition({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  if (Platform.OS !== "web") return <>{children}</>;
  // No transform here: fixed desktop navigation must stay anchored to the viewport.
  return <MotionView active={focused} distance={0} style={{ flex: 1 }}>{children}</MotionView>;
}
