// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Build output, Expo-generated types, and the Deno edge functions
    // (which import from https://esm.sh/* URLs the Node resolver can't see)
    // are not part of the Expo app's lint surface.
    ignores: ["dist/*", ".expo/*", "supabase/functions/**"],
  },
  {
    rules: {
      // Apostrophes/quotes inside React Native <Text> copy are perfectly fine;
      // this rule is pure noise for a content-heavy app.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // Vercel serverless handlers legitimately read process.env dynamically.
    // The Expo static-env rule only applies to client code that gets inlined.
    files: ["api/**"],
    rules: { "expo/no-dynamic-env-var": "off" },
  },
]);
