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
// Name and description come from _locales; English is the default catalog.
const english = JSON.parse(readFileSync(join(root, "_locales", "en", "messages.json"), "utf8"));
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.name, "__MSG_extName__");
assert.equal(manifest.description, "__MSG_extDescription__");
assert.equal(english.extName.message, "Mori Browser Extension");
assert.equal(english.extDescription.message, "Opt-in browser activity capture companion for Mori.");
assert.deepEqual(manifest.permissions, ["storage", "tabs", "webNavigation", "nativeMessaging"]);
assert.deepEqual(manifest.icons, {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
});
assert.deepEqual(manifest.action.default_icon, manifest.icons);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.incognito, "not_allowed");
assert.deepEqual(
  manifest.permissions.filter((permission) => forbiddenPermissions.includes(permission)),
  [],
);
assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);

for (const path of [
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "src/background.js",
  "src/backgroundController.js",
  "src/core/moriBrowserExtensionCore.js",
  "src/popup.html",
  "src/popup.js",
  "src/transport/nativeMessagingClient.js",
  "scripts/chrome-native-smoke.mjs",
  "scripts/inspect-chrome-package.mjs",
  "scripts/package-chrome.mjs",
  "scripts/lib/chromePackage.mjs",
  "scripts/lib/chromeNativeSmokeSupport.mjs",
]) {
  readFileSync(join(root, path));
}

console.log("extension validation: ok");
