import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * Web-only HTML shell for every page of the static export.
 * Dark document so there's no white flash, dark scrollbars, hover/cursor
 * affordances for pointer devices, PWA manifest, and link-preview meta.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <title>ArcadeTracker</title>
        <meta name="description" content="Skee-ball league scores, stats, standings & more." />
        <meta name="theme-color" content="#000000" />
        <meta property="og:title" content="ArcadeTracker" />
        <meta property="og:description" content="Skee-ball league scores, stats, standings & more." />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const css = `
html, body { background: #000; }
body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
::selection { background: rgba(6, 182, 212, 0.35); }

/* Dark scrollbars */
* { scrollbar-width: thin; scrollbar-color: #242424 #000; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: #222; border-radius: 6px; border: 2px solid #000; }
*::-webkit-scrollbar-track { background: #000; }

/* Pointer affordance + hover feedback on pressables (RN-web focusables) */
div[tabindex="0"] { cursor: pointer; }
@media (hover: hover) {
  div[tabindex="0"]:hover { opacity: 0.88; transition: opacity 0.12s ease; }
}

input, textarea { caret-color: #06b6d4; }
`;
