import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const MORI_BROWSER_NATIVE_HOST_NAME = "com.swarea.mori.browser";
export const REQUIRED_SMOKE_CHECKS = [
  "extensionLoaded",
  "hostRegistered",
  "contextSnapshot",
  "navigationCommitted",
  "tabActivated",
  "popupOptIn",
  "captureOffBlocked",
  "moriUnavailable",
  "hostMissing",
  "urlSanitized",
];

const DEFAULT_CHROME_CANDIDATES = [
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
];

export function parseSmokeArgs(argv, env = process.env) {
  const options = {
    chromePath: env.CHROME_PATH || "",
    extensionRoot: env.MORI_BROWSER_EXTENSION_ROOT || "",
    moriWorktree: env.MORI_WORKTREE || "",
    nativeHostPath: env.MORI_BROWSER_NATIVE_HOST_PATH || "",
    keepProfile: env.MORI_BROWSER_SMOKE_KEEP_PROFILE === "1",
    registrationMode: env.MORI_BROWSER_SMOKE_REGISTRATION_MODE || "temporary",
    expectedManifestPath: env.MORI_BROWSER_NATIVE_HOST_MANIFEST_PATH || "",
    skipMoriUnavailable: false,
    skipHostMissing: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--chrome-path") {
      options.chromePath = readArgValue(argv, ++index, arg);
    } else if (arg === "--extension-root") {
      options.extensionRoot = readArgValue(argv, ++index, arg);
    } else if (arg === "--mori-worktree") {
      options.moriWorktree = readArgValue(argv, ++index, arg);
    } else if (arg === "--native-host-path") {
      options.nativeHostPath = readArgValue(argv, ++index, arg);
    } else if (arg === "--keep-profile") {
      options.keepProfile = true;
    } else if (arg === "--registration-mode") {
      options.registrationMode = readArgValue(argv, ++index, arg);
    } else if (arg === "--expected-manifest-path") {
      options.expectedManifestPath = readArgValue(argv, ++index, arg);
    } else if (arg === "--skip-mori-unavailable") {
      options.skipMoriUnavailable = true;
    } else if (arg === "--skip-host-missing") {
      options.skipHostMissing = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["temporary", "existing"].includes(options.registrationMode)) {
    throw new Error("--registration-mode must be temporary or existing.");
  }

  return options;
}

export function usage() {
  return [
    "Usage: npm run smoke:chrome-native -- [options]",
    "",
    "Options:",
    "  --chrome-path <path>        Chrome executable path.",
    "  --extension-root <path>      Unpacked extension directory to load.",
    "  --mori-worktree <path>      Mori worktree that owns connectors/browser-native.",
    "  --native-host-path <path>   mori-browser-native-host executable path.",
    "  --keep-profile             Keep temporary Chrome profiles for debugging.",
    "  --registration-mode <mode>  temporary or existing Native Messaging registration.",
    "  --expected-manifest-path <path>",
    "                              Existing registration manifest expected in packaged mode.",
    "  --skip-mori-unavailable    Skip the unavailable-relay failure scenario.",
    "  --skip-host-missing        Skip the missing native host registration scenario.",
    "",
    "Mori Desktop must be running for the happy-path scenario.",
  ].join("\n");
}

export function defaultMoriWorktree(extensionRoot) {
  return path.resolve(extensionRoot, "..", "mori-browser-native-host-dev");
}

export function defaultNativeHostPath(moriWorktree) {
  const binary = process.platform === "win32" ? "mori-browser-native-host.exe" : "mori-browser-native-host";
  return path.join(moriWorktree, "src-tauri", "target", "debug", binary);
}

export function resolveSmokePaths({ extensionRoot, chromePath, moriWorktree, nativeHostPath }) {
  const resolvedExtensionRoot = path.resolve(extensionRoot);
  const resolvedMoriWorktree = path.resolve(moriWorktree || defaultMoriWorktree(resolvedExtensionRoot));
  const resolvedNativeHostPath = path.resolve(
    nativeHostPath || defaultNativeHostPath(resolvedMoriWorktree),
  );
  const resolvedChromePath = discoverChromePath(chromePath);

  return {
    chromePath: resolvedChromePath,
    extensionRoot: resolvedExtensionRoot,
    moriWorktree: resolvedMoriWorktree,
    nativeHostPath: resolvedNativeHostPath,
  };
}

export function discoverChromePath(explicitPath = "", candidates = DEFAULT_CHROME_CANDIDATES) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!existsSync(resolved)) throw new Error(`Chrome executable not found: ${resolved}`);
    return resolved;
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Chrome executable not found. Pass --chrome-path or set CHROME_PATH to a Google Chrome executable.",
  );
}

export function validatePrerequisites({
  extensionRoot,
  moriWorktree,
  nativeHostPath,
  registrationMode = "temporary",
}) {
  const installScript = nativeHostInstallScript(moriWorktree);
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const missing = [
    ["extension manifest", manifestPath],
    ["native host binary", nativeHostPath],
  ];
  if (registrationMode === "temporary") {
    missing.push(["Mori native host installer", installScript]);
  }
  const absent = missing.filter(([, filePath]) => !existsSync(filePath));

  if (absent.length > 0) {
    const details = absent.map(([label, filePath]) => `${label}: ${filePath}`).join("\n");
    throw new Error(`Required smoke prerequisite not found:\n${details}`);
  }
}

export function nativeHostInstallScript(moriWorktree) {
  return path.join(moriWorktree, "connectors", "browser-native", "install-native-host.ps1");
}

export function nativeHostUninstallScript(moriWorktree) {
  return path.join(moriWorktree, "connectors", "browser-native", "uninstall-native-host.ps1");
}

export function chromeNativeHostRegistryPath(browser = "chrome") {
  if (browser === "edge") {
    return `HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${MORI_BROWSER_NATIVE_HOST_NAME}`;
  }
  return `HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${MORI_BROWSER_NATIVE_HOST_NAME}`;
}

export function nativeHostManifestPath(tempRoot) {
  return path.join(tempRoot, `${MORI_BROWSER_NATIVE_HOST_NAME}.json`);
}

export function buildNativeHostAllowedOrigin(extensionId) {
  if (!isChromiumExtensionId(extensionId)) {
    throw new Error(`Invalid Chromium extension id: ${extensionId}`);
  }
  return `chrome-extension://${extensionId.toLowerCase()}/`;
}

export function isChromiumExtensionId(value) {
  return typeof value === "string" && /^[a-p]{32}$/i.test(value);
}

export function buildInstallNativeHostCommand({
  moriWorktree,
  nativeHostPath,
  extensionId,
  manifestPath,
  browser = "chrome",
}) {
  return {
    command: "powershell",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      nativeHostInstallScript(moriWorktree),
      "-Browser",
      browser,
      "-HostPath",
      nativeHostPath,
      "-ExtensionId",
      extensionId,
      "-ManifestPath",
      manifestPath,
    ],
  };
}

export function createSmokeResult() {
  return {
    chromeExecutable: "",
    chromeVersion: "",
    cdpProduct: "",
    cdpProtocolVersion: "",
    extensionsLoadUnpackedAvailable: false,
    temporaryProfiles: [],
    extensionLoaded: false,
    extensionId: "",
    hostRegistered: false,
    contextSnapshot: false,
    tabActivated: false,
    navigationCommitted: false,
    popupOptIn: false,
    captureOffBlocked: false,
    moriUnavailable: false,
    hostMissing: false,
    urlSanitized: false,
    skipped: [],
  };
}

export function assertRequiredSmokeResult(result) {
  const skipped = new Set(result.skipped || []);
  const failed = REQUIRED_SMOKE_CHECKS.filter((key) => !skipped.has(key) && result[key] !== true);
  if (failed.length > 0) {
    throw new Error(`Required Chrome Native Messaging smoke checks failed: ${failed.join(", ")}`);
  }
}

export function parseChromeVersion(stdout) {
  return String(stdout).trim();
}

export function readDevToolsActivePort(text) {
  const [port, browserPath] = String(text).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || !browserPath?.startsWith("/")) {
    throw new Error("Chrome DevToolsActivePort file did not contain a browser websocket path.");
  }
  return {
    port: Number(port),
    browserWebSocketPath: browserPath,
    browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`,
  };
}

export function readDevToolsListeningLine(text) {
  const match = String(text).match(/DevTools listening on (ws:\/\/[^\s]+)/);
  if (!match) return null;
  const url = new URL(match[1]);
  return {
    port: Number(url.port),
    browserWebSocketPath: `${url.pathname}${url.search}`,
    browserWebSocketUrl: match[1],
  };
}

export function makeTempProfilePrefix() {
  return path.join(os.tmpdir(), "mori-browser-smoke-");
}

function readArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
