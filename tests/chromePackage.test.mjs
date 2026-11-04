import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHROME_PACKAGE_FILES,
  inspectChromePackage,
  readManifest,
  readZipEntries,
  stageChromePackage,
  writeChromeZip,
} from "../scripts/lib/chromePackage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("Chrome Web Store package", () => {
  it("has an explicit runtime allowlist", () => {
    assert.deepEqual(CHROME_PACKAGE_FILES, [
      "manifest.json",
      "_locales/en/messages.json",
      "_locales/ko/messages.json",
      "icons/icon-16.png",
      "icons/icon-32.png",
      "icons/icon-48.png",
      "icons/icon-128.png",
      "src/background.js",
      "src/backgroundController.js",
      "src/core/moriBrowserExtensionCore.js",
      "src/popup.css",
      "src/popup.html",
      "src/popup.js",
      "src/popupState.js",
      "src/transport/nativeMessagingClient.js",
    ]);
  });

  it("pins the unpacked id with a key and leaves the key out of the store package", () => {
    // Mori's installer registers its native host for this id; changing the key
    // changes the id and breaks that registration.
    const manifest = readManifest(root);
    const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
    const id = [...digest.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
    assert.equal(id, "nmkjbmmnefgglmkddfokahclckjkldek");

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mori-chrome-package-key-"));
    try {
      const stagingDir = path.join(tempRoot, "stage");
      stageChromePackage({ root, stagingDir });
      const { key: _key, ...withoutKey } = manifest;
      assert.deepEqual(readManifest(stagingDir), withoutKey);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("stages and inspects the same deterministic zip entries", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mori-chrome-package-test-"));
    try {
      const stagingDir = path.join(tempRoot, "stage");
      const zipPath = path.join(tempRoot, "mori-browser-extension-0.1.0.zip");

      stageChromePackage({ root, stagingDir });
      writeChromeZip({ root: stagingDir, zipPath });
      const entries = readZipEntries(zipPath).map((entry) => entry.name);
      assert.deepEqual(entries, CHROME_PACKAGE_FILES);
      assert.deepEqual(inspectChromePackage({ root, stagingDir, zipPath }).zipEntries, entries);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
