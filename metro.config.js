const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const path = require("path");

const config = getSentryExpoConfig(__dirname);

// Block .claude worktrees from Metro's file watcher — those paths contain
// invalid characters on Windows that crash the watcher.
config.resolver = config.resolver || {};
const existingBlockList = config.resolver.blockList
  ? Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  : [];
config.resolver.blockList = [...existingBlockList, /[/\\]\.claude[/\\].*/];

// On web, @sentry/react-native imports native-only modules that don't exist.
// Redirect to a no-op stub so the web bundle compiles cleanly.
const sentryStub = path.resolve(__dirname, "src/lib/sentry-stub.ts");
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "@sentry/react-native") {
    return { filePath: sentryStub, type: "sourceFile" };
  }
  if (upstream) return upstream(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
