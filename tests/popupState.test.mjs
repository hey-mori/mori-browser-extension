import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPopupState } from "../src/popupState.js";

test("projects consent and delivery into honest user states", () => {
  const project = (transport, captureEnabled = true) => projectPopupState({ captureEnabled, transport }, 60_000);
  assert.equal(project({ state: "connected" }, false).status, "statusCaptureOff");
  assert.equal(project({ state: "connected" }).status, "statusWaiting");
  assert.equal(project({ pending: 1 }).status, "statusSending");
  assert.equal(project({ lastAcknowledgement: { ok: true }, updatedAt: new Date(50_000).toISOString() }).status, "statusConnected");
  assert.equal(project({ lastAcknowledgement: { ok: true }, updatedAt: new Date(0).toISOString() }).status, "statusWaiting");
  assert.equal(project({ connected: true, lastError: { code: "mori_unavailable" } }).status, "statusMoriNotRunning");
  assert.equal(project({ lastError: { code: "native_host_disconnected", message: "secret" } }).status, "statusIntegrationUnavailable");
  assert.equal(project({ lastError: { code: "persistence_failed" } }).status, "statusSaveFailed");
  assert.equal(JSON.stringify(project({ lastError: { code: "error", message: "secret" } })).includes("secret"), false);
});

test("every key the popup can show exists in every locale", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const root = new URL("../_locales/", import.meta.url);
  const locales = readdirSync(root);
  assert.deepEqual(locales.sort(), ["en", "ko"]);
  const catalogs = locales.map((locale) => JSON.parse(readFileSync(new URL(`${locale}/messages.json`, root), "utf8")));
  const states = [
    { captureEnabled: false },
    { captureEnabled: true },
    { captureEnabled: true, transport: { pending: 1 } },
    { captureEnabled: true, transport: { lastAcknowledgement: { ok: true }, updatedAt: new Date(50_000).toISOString() } },
    ...["mori_unavailable", "native_host_unavailable", "persistence_failed", "other"].map((code) => ({
      captureEnabled: true, transport: { lastError: { code } },
    })),
  ];
  const html = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
  const keys = new Set([
    ...states.flatMap((state) => {
      const projection = projectPopupState(state, 60_000);
      return [projection.status, projection.detail].filter(Boolean);
    }),
    ...[...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]),
    ...[...script.matchAll(/message\("([^"]+)"/g)].map((match) => match[1]),
  ]);
  for (const catalog of catalogs) {
    for (const key of keys) assert.ok(catalog[key]?.message, `missing ${key}`);
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort());
  }
});
