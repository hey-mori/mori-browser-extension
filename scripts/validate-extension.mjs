import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const forbiddenPermissions = [
  "history",
  "cookies",
  "webRequest",
  "scripting",
  "downloads",
  "bookmarks",
  "clipboardRead",
  "clipboardWrite",
];

assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "tabs", "webNavigation", "nativeMessaging"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.incognito, "not_allowed");
assert.deepEqual(
  manifest.permissions.filter((permission) => forbiddenPermissions.includes(permission)),
  [],
);
assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);

for (const path of [
  "src/background.js",
  "src/backgroundController.js",
  "src/core/moriBrowserExtensionCore.js",
  "src/popup.html",
  "src/popup.js",
  "src/transport/nativeMessagingClient.js",
  "scripts/chrome-native-smoke.mjs",
  "scripts/lib/chromeNativeSmokeSupport.mjs",
]) {
  readFileSync(join(root, path), "utf8");
}

console.log("extension validation: ok");
