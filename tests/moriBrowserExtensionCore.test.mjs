import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  appendRecentEvent,
  buildContextBootstrapEnvelope,
  buildNavigationCommittedEnvelope,
  buildTabActivatedEnvelope,
  defaultCaptureState,
  sanitizeBrowserUrl,
  sanitizeTab,
  sanitizeWindow,
} from "../src/core/moriBrowserExtensionCore.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = { name: "Mori Browser Extension", version: "0.1.0" };

function fixture(name) {
  return JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
}

describe("manifest permissions", () => {
  it("uses the minimal Chromium extension permissions", () => {
    const extensionManifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    assert.equal(extensionManifest.manifest_version, 3);
    assert.deepEqual(extensionManifest.permissions, [
      "storage",
      "tabs",
      "webNavigation",
      "nativeMessaging",
    ]);
    assert.equal(extensionManifest.host_permissions, undefined);
    assert.equal(extensionManifest.content_scripts, undefined);
    assert.equal(extensionManifest.incognito, "not_allowed");
  });
});

describe("privacy and opt-in defaults", () => {
  it("defaults capture off", () => {
    assert.deepEqual(defaultCaptureState(), {
      captureEnabled: false,
      options: {
        captureTitles: false,
        urlDetailPolicy: "origin-path",
      },
    });
  });

  it("sanitizes credentials, query, and fragment", () => {
    assert.deepEqual(sanitizeBrowserUrl("https://user:pass@example.com/a?token=123#secret"), {
      url: "https://example.com/a",
      origin: "https://example.com",
      internal: false,
      queryCaptured: false,
      fragmentCaptured: false,
    });
  });

  it("drops internal browser URLs and incognito tabs", () => {
    assert.equal(sanitizeTab({ id: 1, windowId: 1, url: "chrome://extensions", active: true }), null);
    assert.equal(sanitizeTab({ id: 2, windowId: 1, url: "https://example.com", incognito: true }), null);
    assert.deepEqual(
      sanitizeWindow({
        id: 1,
        focused: true,
        incognito: false,
        tabs: [
          { id: 1, windowId: 1, url: "edge://settings", active: true },
          { id: 2, windowId: 1, url: "https://example.com/a?secret=1#x", title: "Sensitive title" },
        ],
      }),
      {
        id: 1,
        focused: true,
        incognito: false,
        tabs: [{ id: 2, windowId: 1, active: false, url: "https://example.com/a" }],
      },
    );
  });

  it("does not capture page titles unless explicitly configured", () => {
    const tab = {
      id: 1,
      windowId: 1,
      active: true,
      url: "https://example.com/research?token=secret#private",
      title: "Sensitive page title",
    };

    assert.deepEqual(sanitizeTab(tab), {
      id: 1,
      windowId: 1,
      active: true,
      url: "https://example.com/research",
    });
    assert.equal(JSON.stringify(sanitizeTab(tab)).includes("Sensitive page title"), false);
    assert.equal(
      sanitizeTab(tab, { captureTitles: true, urlDetailPolicy: "origin-path" }).title,
      "Sensitive page title",
    );
  });
});

describe("browser observation v1 contract", () => {
  it("builds the context snapshot fixture", () => {
    const envelope = buildContextBootstrapEnvelope({
      manifest,
      observedAt: "2026-09-09T00:00:00.000Z",
      windows: [
        {
          id: 3,
          focused: true,
          state: "normal",
          tabs: [
            {
              id: 21,
              windowId: 3,
              active: true,
              url: "https://github.com/swarea/mori?token=abc#section",
              pinned: false,
              audible: false,
              status: "complete",
            },
          ],
        },
      ],
    });
    assert.deepEqual(envelope, fixture("context-snapshot.v1.json"));
  });

  it("builds the tab activation fixture", () => {
    const envelope = buildTabActivatedEnvelope({
      manifest,
      activeInfo: { tabId: 21, windowId: 3 },
      occurredAt: "2026-09-09T00:01:00.000Z",
      tab: { id: 21, windowId: 3, active: true, url: "https://example.com/a?x=1#top" },
      window: { id: 3, focused: true },
    });
    assert.deepEqual(envelope, fixture("tab-activated.v1.json"));
  });

  it("builds main-frame navigation fixtures only", () => {
    assert.equal(
      buildNavigationCommittedEnvelope({
        manifest,
        details: {
          tabId: 21,
          frameId: 1,
          url: "https://example.com/frame",
          timeStamp: Date.parse("2026-09-09T00:02:00.000Z"),
        },
      }),
      null,
    );

    const envelope = buildNavigationCommittedEnvelope({
      manifest,
      details: {
        tabId: 21,
        frameId: 0,
        url: "https://docs.oracle.com/en-us/iaas/?token=abc#top",
        timeStamp: Date.parse("2026-09-09T00:02:00.000Z"),
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      },
      tab: { id: 21, windowId: 3, active: true, title: "OCI" },
    });
    assert.deepEqual(envelope, fixture("navigation-committed.v1.json"));
  });

  it("keeps only a bounded sanitized debug event buffer", () => {
    const events = Array.from({ length: 25 }, (_, index) => ({
      id: index,
      version: 1,
      source: "browser",
      kind: "tab_activated",
    }));
    const buffered = events.reduce((existing, event) => appendRecentEvent(existing, event, 20), []);
    assert.equal(buffered.length, 20);
    assert.equal(buffered[0].id, 24);
    assert.equal(buffered[19].id, 5);
  });
});
