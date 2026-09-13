import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPopupState } from "../src/popupState.js";

test("projects consent and delivery into honest user states", () => {
  const project = (transport, captureEnabled = true) => projectPopupState({ captureEnabled, transport }, 60_000);
  assert.equal(project({ state: "connected" }, false).status, "Capture off");
  assert.equal(project({ state: "connected" }).status, "Waiting for browser activity");
  assert.equal(project({ pending: 1 }).status, "Sending to Mori");
  assert.equal(project({ lastAcknowledgement: { ok: true }, updatedAt: new Date(50_000).toISOString() }).status, "Mori connected");
  assert.equal(project({ lastAcknowledgement: { ok: true }, updatedAt: new Date(0).toISOString() }).status, "Waiting for browser activity");
  assert.equal(project({ connected: true, lastError: { code: "mori_unavailable" } }).status, "Mori isn't running");
  assert.equal(project({ lastError: { code: "native_host_disconnected", message: "secret" } }).status, "Browser integration unavailable");
  assert.equal(project({ lastError: { code: "persistence_failed" } }).status, "Mori couldn't save activity");
  assert.equal(JSON.stringify(project({ lastError: { code: "error", message: "secret" } })).includes("secret"), false);
});
