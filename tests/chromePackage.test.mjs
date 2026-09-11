import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHROME_PACKAGE_FILES,
  inspectChromePackage,
  readZipEntries,
  stageChromePackage,
  writeChromeZip,
} from "../scripts/lib/chromePackage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("Chrome Web Store package", () => {
  it("has an explicit runtime allowlist", () => {
    assert.deepEqual(CHROME_PACKAGE_FILES, [
      "manifest.json",
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
      "src/transport/nativeMessagingClient.js",
    ]);
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
