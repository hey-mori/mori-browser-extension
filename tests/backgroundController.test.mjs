import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAST_SNAPSHOT_KEY,
  RECENT_EVENTS_KEY,
} from "../src/core/moriBrowserExtensionCore.js";
import { createMoriBrowserBackground } from "../src/backgroundController.js";

describe("background controller native transport", () => {
  it("keeps capture off from sending observations", async () => {
    const nativeTransport = createFakeTransport();
    const controller = createMoriBrowserBackground({
      runtimeApi: createFakeRuntimeApi(),
      nativeTransport,
      debugLog: noop,
    });

    await controller.initialize();
    await controller.handleTabActivated({ tabId: 21, windowId: 3 });

    assert.equal(nativeTransport.sent.length, 0);
    assert.equal(nativeTransport.connected, false);
  });

  it("connects before sending the opt-in context snapshot", async () => {
    const nativeTransport = createFakeTransport();
    const controller = createMoriBrowserBackground({
      runtimeApi: createFakeRuntimeApi(),
      nativeTransport,
      debugLog: noop,
    });

    await controller.setCaptureEnabled(true);

    assert.equal(nativeTransport.connects, 1);
    assert.equal(nativeTransport.sent.length, 1);
    assert.equal(nativeTransport.sent[0].kind, "context_snapshot");
  });

  it("sends only sanitized envelopes while capture remains enabled", async () => {
    const nativeTransport = createFakeTransport();
    const runtimeApi = createFakeRuntimeApi();
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport, debugLog: noop });

    await controller.setCaptureEnabled(true);
    await controller.handleTabActivated({ tabId: 21, windowId: 3 });
    await controller.handleNavigationCommitted({
      tabId: 21,
      frameId: 0,
      url: "https://user:pass@example.com/a?token=123#secret",
      timeStamp: Date.parse("2026-09-09T00:02:00.000Z"),
      transitionType: "typed",
    });

    const tabActivation = nativeTransport.sent.find((event) => event.kind === "tab_activated");
    const navigation = nativeTransport.sent.find((event) => event.kind === "navigation_committed");

    assert.equal(tabActivation.payload.tab.url, "https://example.com/a");
    assert.equal(navigation.payload.details.url, "https://example.com/a");
    assert.equal(JSON.stringify(nativeTransport.sent).includes("token=123"), false);
    assert.equal(JSON.stringify(nativeTransport.sent).includes("secret"), false);
    assert.equal(JSON.stringify(nativeTransport.sent).includes("user:pass"), false);
  });

  it("disconnects and stops sending after capture is disabled", async () => {
    const nativeTransport = createFakeTransport();
    const runtimeApi = createFakeRuntimeApi();
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport, debugLog: noop });

    await controller.setCaptureEnabled(true);
    await controller.setCaptureEnabled(false);
    await controller.handleNavigationCommitted({
      tabId: 21,
      frameId: 0,
      url: "https://example.com/after-off",
    });

    assert.equal(nativeTransport.disconnects, 1);
    assert.equal(nativeTransport.sent.some((event) => event.payload?.details?.url === "https://example.com/after-off"), false);
    assert.deepEqual(runtimeApi.storage.session.data[LAST_SNAPSHOT_KEY], null);
    assert.deepEqual(runtimeApi.storage.session.data[RECENT_EVENTS_KEY], []);
  });

  it("drops observations whose async lookup finishes after capture is disabled", async () => {
    const nativeTransport = createFakeTransport();
    const delayedTab = createDeferred();
    const runtimeApi = createFakeRuntimeApi({
      async getTab() {
        return delayedTab.promise;
      },
    });
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport, debugLog: noop });

    await controller.setCaptureEnabled(true);
    const activation = controller.handleTabActivated({ tabId: 21, windowId: 3 });
    await controller.setCaptureEnabled(false);
    delayedTab.resolve(runtimeApi.fixtures.tab);
    await activation;

    assert.equal(nativeTransport.sent.length, 1);
    assert.equal(nativeTransport.sent[0].kind, "context_snapshot");
    assert.deepEqual(runtimeApi.storage.session.data[RECENT_EVENTS_KEY], []);
    assert.deepEqual(runtimeApi.storage.session.data[LAST_SNAPSHOT_KEY], null);
  });

  it("records Mori unavailable acknowledgements in debug state", async () => {
    const nativeTransport = createFakeTransport({
      sendResult: {
        ok: false,
        acknowledgement: { ok: false, code: "mori_unavailable", message: "Mori unavailable" },
      },
      status: {
        state: "mori_unavailable",
        lastError: { code: "mori_unavailable", message: "Mori unavailable" },
      },
    });
    const controller = createMoriBrowserBackground({
      runtimeApi: createFakeRuntimeApi(),
      nativeTransport,
      debugLog: noop,
    });

    await controller.setCaptureEnabled(true);
    const state = await controller.readDebugState();

    assert.equal(state.transport.state, "mori_unavailable");
    assert.equal(state.transport.lastError.message, "Mori unavailable");
  });
});

function createFakeTransport({
  sendResult = { ok: true, acknowledgement: { ok: true, kind: "context_snapshot", route: "context" } },
  status = { state: "connected", lastError: null, lastAcknowledgement: null },
} = {}) {
  return {
    connected: false,
    connects: 0,
    disconnects: 0,
    sent: [],
    connect() {
      this.connected = true;
      this.connects += 1;
    },
    disconnect() {
      this.connected = false;
      this.disconnects += 1;
    },
    getStatus() {
      return {
        hostName: "com.swarea.mori.browser",
        connected: this.connected,
        pending: 0,
        updatedAt: "2026-09-10T00:00:00.000Z",
        ...status,
      };
    },
    async sendObservation(envelope) {
      this.sent.push(envelope);
      return sendResult;
    },
  };
}

function noop() {}

function createFakeRuntimeApi({ getTab, getWindow, getAllWindows } = {}) {
  const manifest = { name: "Mori Browser Extension", version: "0.1.0" };
  const tab = {
    id: 21,
    windowId: 3,
    active: true,
    url: "https://user:pass@example.com/a?token=123#secret",
    title: "Sensitive title",
  };
  const window = {
    id: 3,
    focused: true,
    state: "normal",
    incognito: false,
    tabs: [tab],
  };

  return {
    runtime: {
      getManifest() {
        return manifest;
      },
    },
    fixtures: {
      tab,
      window,
    },
    storage: {
      local: createStorageArea(),
      session: createStorageArea(),
    },
    tabs: {
      async get() {
        if (getTab) return getTab();
        return tab;
      },
    },
    windows: {
      async get() {
        if (getWindow) return getWindow();
        return { id: 3, focused: true, incognito: false };
      },
      async getAll() {
        if (getAllWindows) return getAllWindows();
        return [window];
      },
    },
  };
}

function createStorageArea() {
  return {
    data: {},
    async get(keys) {
      if (typeof keys === "string") return { [keys]: this.data[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, this.data[key]]));
      }
      return { ...this.data };
    },
    async set(values) {
      Object.assign(this.data, values);
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
