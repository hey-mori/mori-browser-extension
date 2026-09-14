import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAST_SNAPSHOT_KEY,
  RECENT_EVENTS_KEY,
} from "../src/core/moriBrowserExtensionCore.js";
import {
  createMoriBrowserBackground,
  installMoriBrowserBackground,
} from "../src/backgroundController.js";

describe("background controller native transport", () => {
  it("does not read or save a diagnostic snapshot with capture off", async () => {
    let reads = 0;
    const runtimeApi = createFakeRuntimeApi({ getAllWindows: async () => { reads++; return []; } });
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport: createFakeTransport(), debugLog: noop });
    assert.equal((await controller.handleMessage({ type: "mori.browser.bootstrap_context" })).ok, false);
    assert.equal(reads, 0);
    assert.equal(runtimeApi.storage.session.data[LAST_SNAPSHOT_KEY], undefined);
  });

  it("refreshes missing Mori context once after the next successful activity", async () => {
    const transport = createFakeTransport({ sendResult: { ok: true, acknowledgement: { ok: true, contextRequired: true } } });
    const runtimeApi = createFakeRuntimeApi();
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport: transport, debugLog: noop });
    await controller.setCaptureEnabled(true);
    await controller.handleTabActivated({ tabId: 21, windowId: 3 });
    assert.deepEqual(transport.sent.map((e) => e.kind), ["context_snapshot", "tab_activated", "context_snapshot"]);
    const restarted = createMoriBrowserBackground({ runtimeApi, nativeTransport: transport, debugLog: noop });
    await restarted.handleStartup();
    assert.equal(transport.sent.at(-1).kind, "context_snapshot");
    assert.equal((await restarted.readDebugState()).captureEnabled, true);
  });

  it("drops late window and bootstrap lookups through repeated consent changes", async () => {
    for (const pendingKind of ["window", "bootstrap", "navigation", "history"]) {
      const gate = createDeferred();
      const entered = createDeferred();
      let delay = false;
      const blocked = () => { entered.resolve(); return gate.promise; };
      const runtimeApi = createFakeRuntimeApi({
        getWindow: async () => delay && pendingKind !== "bootstrap" ? blocked() : { id: 3 },
        getAllWindows: async () => delay && pendingKind === "bootstrap" ? blocked() : [],
      });
      const transport = createFakeTransport();
      const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport: transport, debugLog: noop });
      await controller.setCaptureEnabled(true);
      delay = true;
      const pending = pendingKind === "bootstrap" ? controller.handleMessage({ type: "mori.browser.bootstrap_context" })
        : pendingKind === "navigation" ? controller.handleNavigationCommitted({ tabId: 21, frameId: 0, url: "https://example.com/late" })
        : pendingKind === "history" ? controller.handleHistoryStateUpdated({ tabId: 21, frameId: 0, url: "https://example.com/late-history" })
        : controller.handleTabActivated({ tabId: 21, windowId: 3 });
      await entered.promise;
      await controller.setCaptureEnabled(false);
      gate.resolve(pendingKind === "bootstrap" ? [] : { id: 3 });
      await pending;
      assert.equal(transport.sent.length, 1);
      assert.deepEqual(runtimeApi.storage.session.data[RECENT_EVENTS_KEY], []);
    }
  });
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
    await controller.handleHistoryStateUpdated({
      tabId: 21,
      frameId: 0,
      url: "https://user:pass@example.com/spa/next?token=456#private",
      timeStamp: Date.parse("2026-09-14T00:03:00.000Z"),
      transitionType: "link",
    });

    const tabActivation = nativeTransport.sent.find((event) => event.kind === "tab_activated");
    const navigation = nativeTransport.sent.find((event) => event.kind === "navigation_committed");
    const history = nativeTransport.sent.find((event) => event.kind === "history_state_updated");

    assert.equal(tabActivation.payload.tab.url, "https://example.com/a");
    assert.equal(navigation.payload.details.url, "https://example.com/a");
    assert.equal(history.payload.details.url, "https://example.com/spa/next");
    assert.equal(JSON.stringify(nativeTransport.sent).includes("token=123"), false);
    assert.equal(JSON.stringify(nativeTransport.sent).includes("token=456"), false);
    assert.equal(JSON.stringify(nativeTransport.sent).includes("secret"), false);
    assert.equal(JSON.stringify(nativeTransport.sent).includes("#private"), false);
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
    await controller.handleHistoryStateUpdated({
      tabId: 21,
      frameId: 0,
      url: "https://example.com/after-off-spa",
    });

    assert.equal(nativeTransport.disconnects, 1);
    assert.equal(nativeTransport.sent.some((event) => event.payload?.details?.url === "https://example.com/after-off"), false);
    assert.deepEqual(runtimeApi.storage.session.data[LAST_SNAPSHOT_KEY], null);
    assert.deepEqual(runtimeApi.storage.session.data[RECENT_EVENTS_KEY], []);
  });

  it("registers the History API listener with the background lifecycle", () => {
    const listeners = {
      installed: createChromeEvent(),
      startup: createChromeEvent(),
      message: createChromeEvent(),
      activated: createChromeEvent(),
      committed: createChromeEvent(),
      historyStateUpdated: createChromeEvent(),
    };
    const runtimeApi = {
      runtime: {
        onInstalled: listeners.installed,
        onStartup: listeners.startup,
        onMessage: listeners.message,
      },
      tabs: { onActivated: listeners.activated },
      webNavigation: {
        onCommitted: listeners.committed,
        onHistoryStateUpdated: listeners.historyStateUpdated,
      },
    };
    const calls = [];
    const controller = {
      initialize: async () => calls.push("initialize"),
      handleStartup: async () => calls.push("startup"),
      handleTabActivated: async () => calls.push("activated"),
      handleNavigationCommitted: async () => calls.push("committed"),
      handleHistoryStateUpdated: async () => calls.push("history_state_updated"),
      handleMessage: async () => ({ ok: true }),
    };

    assert.equal(installMoriBrowserBackground({ runtimeApi, controller }), controller);
    assert.equal(typeof listeners.historyStateUpdated.listener, "function");
    listeners.historyStateUpdated.listener({ tabId: 21, frameId: 0, url: "https://example.com/app" });
    assert.deepEqual(calls, ["history_state_updated"]);
  });

  it("retains separate query-only History API observations after sanitization", async () => {
    const nativeTransport = createFakeTransport();
    const controller = createMoriBrowserBackground({
      runtimeApi: createFakeRuntimeApi(),
      nativeTransport,
      debugLog: noop,
    });
    await controller.setCaptureEnabled(true);

    await controller.handleHistoryStateUpdated({
      tabId: 21,
      frameId: 0,
      url: "https://example.com/search?q=one",
    });
    await controller.handleHistoryStateUpdated({
      tabId: 21,
      frameId: 0,
      url: "https://example.com/search?q=two",
    });

    const historyEvents = nativeTransport.sent.filter(
      (event) => event.kind === "history_state_updated",
    );
    assert.equal(historyEvents.length, 2);
    assert.deepEqual(
      historyEvents.map((event) => event.payload.details.url),
      ["https://example.com/search", "https://example.com/search"],
    );
  });

  it("drops observations whose async lookup finishes after capture is disabled", async () => {
    const nativeTransport = createFakeTransport();
    const delayedTab = createDeferred();
    const entered = createDeferred();
    const runtimeApi = createFakeRuntimeApi({
      async getTab() {
        entered.resolve();
        return delayedTab.promise;
      },
    });
    const controller = createMoriBrowserBackground({ runtimeApi, nativeTransport, debugLog: noop });

    await controller.setCaptureEnabled(true);
    const activation = controller.handleTabActivated({ tabId: 21, windowId: 3 });
    await entered.promise;
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

function createChromeEvent() {
  return {
    listener: null,
    addListener(listener) {
      this.listener = listener;
    },
  };
}
