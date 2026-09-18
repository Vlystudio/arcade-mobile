# App motion

Use the shared components when adding interactions so timing and accessibility stay consistent.

- `MotionProvider` follows the system reduced-motion setting, including changes while the app is open. Motion stays off until the preference is available.
- `RouteTransition` fades web screens on focus without remounting them. Native stack navigation uses fades for main tabs and directional transitions for detail screens. Do not key the whole navigator by pathname.
- `MotionView` adds a short fade and 8-point lift to local content changes. Set `transitionKey` to the selected view, not text input or fetched data. Keep fixed-position web navigation outside transformed containers.
- `PressableScale` provides a 2% press response on the same element that owns layout and the tap target. It supports style/children callbacks, disabled controls, hover, and focus. Give icon-only controls an accessible label. Keep separate buttons as siblings rather than nesting them.
- `MotionSheet` owns the modal, backdrop, keyboard avoidance, safe-area padding, and scrolling. Pass panel styles and content directly; do not add another full-screen overlay or vertical scroll container. Keep it mounted and change `visible` to allow the exit animation to finish. It retains the last visible content while closing.
- Toasts fade out before removal and cancel their timers on unmount. Skeleton loops do not block list rendering and become static with reduced motion.

Timing lives in `src/components/motion.tsx`: press 90 ms, release/exit 160 ms, screen 180 ms, sheet entrance 240 ms. Prefer opacity and transforms; avoid animating layout on every frame.

For changes, check normal and reduced motion, rapid open/close/reopen, keyboard/Escape dismissal, small viewports, and desktop navigation alignment. Web browser checks and platform bundle exports do not replace on-device checks of native gestures, keyboard behavior, or frame pacing.
