import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, type PressableProps } from "react-native";
import { useReducedMotion } from "../context/motion-context";
import { MOTION } from "./motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** One element owns both layout and the hit target, including flex and absolute styles. */
export function PressableScale({ style, children, accessibilityRole = "button", ...props }: PressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [interaction, setInteraction] = useState({ pressed: false, hovered: false, focused: false });

  useEffect(() => {
    if (reducedMotion || props.disabled) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    return () => scale.stopAnimation();
  }, [props.disabled, reducedMotion, scale]);

  function animate(pressed: boolean) {
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: pressed && !reducedMotion && !props.disabled ? 0.98 : 1,
      duration: reducedMotion ? 0 : pressed ? MOTION.press : MOTION.release,
      easing: MOTION.easeOut, useNativeDriver: MOTION.nativeDriver,
    }).start();
  }

  const resolvedStyle = StyleSheet.flatten(typeof style === "function" ? style(interaction) : style);
  const transforms = resolvedStyle?.transform;

  return (
    <AnimatedPressable
      {...props}
      accessibilityRole={accessibilityRole}
      style={[resolvedStyle, { transform: [...(Array.isArray(transforms) ? transforms : []), { scale }] }]}
      onPressIn={event => {
        setInteraction(value => ({ ...value, pressed: true }));
        animate(true);
        props.onPressIn?.(event);
      }}
      onPressOut={event => {
        setInteraction(value => ({ ...value, pressed: false }));
        animate(false);
        props.onPressOut?.(event);
      }}
      onHoverIn={event => { setInteraction(value => ({ ...value, hovered: true })); props.onHoverIn?.(event); }}
      onHoverOut={event => { setInteraction(value => ({ ...value, hovered: false })); props.onHoverOut?.(event); }}
      onFocus={event => { setInteraction(value => ({ ...value, focused: true })); props.onFocus?.(event); }}
      onBlur={event => { setInteraction(value => ({ ...value, focused: false })); props.onBlur?.(event); }}
    >
      {typeof children === "function" ? children(interaction) : children}
    </AnimatedPressable>
  );
}
