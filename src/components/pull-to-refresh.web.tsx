import { useEffect } from "react";

/**
 * Global pull-to-refresh for the web build / installed PWA.
 *
 * An iOS home-screen PWA has no browser chrome, so there's no built-in way
 * to reload. This adds the familiar "pull down at the top to refresh"
 * gesture across every screen: when the active scroll area is at the top and
 * the user drags down past a threshold, the page reloads (refetching
 * everything). Horizontal swipes and mid-scroll drags are ignored so normal
 * scrolling and carousels are unaffected. Mounted once at the root.
 */
export function PullToRefresh() {
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    // Touch devices only — desktop (mouse) never fires these.
    if (!("ontouchstart" in window)) return;

    const THRESHOLD = 72; // px of pull needed to trigger a refresh
    const MAX = 96;        // visual clamp

    // Spinner indicator (imperative DOM = smooth, no React re-renders per move)
    const dot = document.createElement("div");
    dot.style.cssText = [
      "position:fixed", "top:0", "left:50%", "z-index:99999",
      "width:38px", "height:38px", "border-radius:50%",
      "background:#141414", "border:1px solid #2a2a2a",
      "display:flex", "align-items:center", "justify-content:center",
      "box-shadow:0 6px 20px rgba(0,0,0,.55)",
      "transform:translateX(-50%) translateY(-60px)", "opacity:0",
      "pointer-events:none",
    ].join(";");
    dot.innerHTML =
      '<div class="ptr-spin" style="width:16px;height:16px;border:2px solid #303030;border-top-color:#06b6d4;border-radius:50%"></div>';
    const kf = document.createElement("style");
    kf.textContent = "@keyframes ptr-rotate{to{transform:rotate(360deg)}}";
    document.head.appendChild(kf);
    document.body.appendChild(dot);
    const spin = dot.firstElementChild as HTMLElement;

    let startY = 0, startX = 0, active = false, dist = 0, scroller: HTMLElement | null = null;

    function nearestScroller(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
        el = el.parentElement;
      }
      return (document.scrollingElement as HTMLElement) ?? document.documentElement;
    }

    function reset(animate = true) {
      active = false; dist = 0;
      dot.style.transition = animate ? "transform .22s ease, opacity .22s ease" : "none";
      dot.style.transform = "translateX(-50%) translateY(-60px)";
      dot.style.opacity = "0";
      spin.style.animation = "none";
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) { active = false; return; }
      scroller = nearestScroller(e.target as HTMLElement);
      if ((scroller?.scrollTop ?? 0) > 0) { active = false; return; }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = true; dist = 0;
      dot.style.transition = "none";
    }

    function onMove(e: TouchEvent) {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      // Ignore horizontal swipes (carousels, tab strips) and upward drags.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { active = false; reset(); return; }
      if ((scroller?.scrollTop ?? 0) > 0) { active = false; reset(); return; }

      dist = Math.min(MAX, dy * 0.5); // resistance
      const y = -60 + Math.min(dist + 18, 76);
      dot.style.transform = `translateX(-50%) translateY(${y}px) rotate(${dist * 3}deg)`;
      dot.style.opacity = String(Math.min(1, dist / 36));
      if (e.cancelable) e.preventDefault(); // stop iOS rubber-band so the pull reads cleanly
    }

    function onEnd() {
      if (!active) return;
      active = false;
      if (dist >= THRESHOLD) {
        dot.style.transition = "transform .15s ease";
        dot.style.transform = "translateX(-50%) translateY(30px)";
        dot.style.opacity = "1";
        spin.style.border = "2px solid #303030";
        spin.style.borderTopColor = "#06b6d4";
        spin.style.animation = "ptr-rotate .6s linear infinite";
        window.location.reload();
      } else {
        reset();
      }
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove as any);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      dot.remove(); kf.remove();
    };
  }, []);

  return null;
}
