import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MORI_BROWSER_NATIVE_HOST_NAME,
  createNativeMessagingClient,
  MAX_PENDING_OBSERVATIONS,
} from "../src/transport/nativeMessagingClient.js";

describe("native messaging client", () => {
  it("bounds pending work and releases every wait on a stalled helper", async () => {
    const port = createFakePort();
    const client = createNativeMessagingClient({ runtimeApi: createRuntimeApi(port), acknowledgementTimeoutMs: 15 });
    const sends = Array.from({ length: MAX_PENDING_OBSERVATIONS }, (_, id) => client.sendObservation({ id }));
    assert.equal((await client.sendObservation({ id: 33 })).acknowledgement.code, "backpressure");
    const outcomes = await Promise.all(sends);
    assert.ok(outcomes.every((result) => result.acknowledgement.code === "mori_timeout"));
    assert.equal(client.getStatus().pending, 0);
    assert.equal(port.disconnected, true);
  });

  it("ignores callbacks from an old port after reconnect", async () => {
    const first = createFakePort();
    const second = createFakePort();
    const client = createNativeMessagingClient({ runtimeApi: createRuntimeApi(first, second) });
    const oldSend = client.sendObservation({ id: 1 });
    client.disconnect();
    await oldSend;
    const next = client.sendObservation({ id: 2 });
    first.emitMessage({ ok: true });
    first.emitDisconnect();
    assert.equal(client.getStatus().pending, 1);
    second.emitMessage({ ok: true, kind: "tab_activated", contextRequired: true });
    assert.equal((await next).acknowledgement.contextRequired, true);
  });
  it("connects to the Mori native host and resolves accepted acknowledgements", async () => {
    const port = createFakePort();
    const runtimeApi = createRuntimeApi(port);
    const client = createNativeMessagingClient({ runtimeApi, now: fixedNow });

    const pending = client.sendObservation({ version: 1, source: "browser" });
    assert.equal(runtimeApi.connectedHostName, MORI_BROWSER_NATIVE_HOST_NAME);
    assert.deepEqual(port.sentMessages, [{ version: 1, source: "browser" }]);

    port.emitMessage({ ok: true, kind: "tab_activated", route: "trace" });
    assert.deepEqual(await pending, {
      ok: true,
      acknowledgement: { ok: true, kind: "tab_activated", route: "trace" },
    });
    assert.equal(client.getStatus().state, "connected");
  });

  it("surfaces Mori unavailable acknowledgements without dropping the port", async () => {
    const port = createFakePort();
    const client = createNativeMessagingClient({
      runtimeApi: createRuntimeApi(port),
      now: fixedNow,
    });

    const pending = client.sendObservation({ version: 1, source: "browser" });
    port.emitMessage({ ok: false, code: "mori_unavailable", message: "Mori unavailable" });

    assert.deepEqual(await pending, {
      ok: false,
      acknowledgement: { ok: false, code: "mori_unavailable", message: "Mori unavailable" },
    });
    assert.equal(client.getStatus().state, "mori_unavailable");
    assert.equal(client.getStatus().connected, true);
  });

  it("rejects pending sends and reconnects lazily after disconnect", async () => {
    const firstPort = createFakePort();
    const secondPort = createFakePort();
    const runtimeApi = createRuntimeApi(firstPort, secondPort);
    const client = createNativeMessagingClient({ runtimeApi, now: fixedNow });

    const firstSend = client.sendObservation({ id: 1 });
    runtimeApi.runtime.lastError = { message: "Specified native messaging host not found." };
    firstPort.emitDisconnect();

    assert.deepEqual(await firstSend, {
      ok: false,
      acknowledgement: {
        ok: false,
        code: "native_host_disconnected",
        message: "Specified native messaging host not found.",
      },
    });
    assert.equal(client.getStatus().state, "disconnected");

    const secondSend = client.sendObservation({ id: 2 });
    assert.deepEqual(secondPort.sentMessages, [{ id: 2 }]);
    secondPort.emitMessage({ ok: true, kind: "context_snapshot", route: "context" });
    assert.equal((await secondSend).ok, true);
  });

  it("disconnects without retaining pending observations", async () => {
    const port = createFakePort();
    const client = createNativeMessagingClient({
      runtimeApi: createRuntimeApi(port),
      now: fixedNow,
    });

    const pending = client.sendObservation({ id: 1 });
    client.disconnect();

    assert.equal(port.disconnected, true);
    assert.deepEqual(await pending, {
      ok: false,
      acknowledgement: {
        ok: false,
        code: "transport_disabled",
        message: "Browser capture was disabled before the native host acknowledged the observation.",
      },
    });
    assert.equal(client.getStatus().state, "disconnected");
    assert.equal(client.getStatus().lastError, null);
  });
});

function fixedNow() {
  return "2026-09-10T00:00:00.000Z";
}

function createRuntimeApi(...ports) {
  const queue = [...ports];
  const api = {
    connectedHostName: null,
    runtime: {
      lastError: null,
      connectNative(hostName) {
        this.lastError = null;
        const port = queue.shift();
        if (!port) throw new Error("No fake port queued.");
        api.connectedHostName = hostName;
        return port;
      },
    },
  };
  return api;
}

function createFakePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  return {
    disconnected: false,
    sentMessages: [],
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      },
    },
    postMessage(message) {
      this.sentMessages.push(message);
    },
    disconnect() {
      this.disconnected = true;
      this.emitDisconnect();
    },
    emitMessage(message) {
      for (const listener of messageListeners) listener(message);
    },
    emitDisconnect() {
      for (const listener of disconnectListeners) listener();
    },
  };
}
