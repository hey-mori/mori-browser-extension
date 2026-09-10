import {
  CAPTURE_STATE_KEY,
  DEFAULT_CAPTURE_OPTIONS,
  LAST_SNAPSHOT_KEY,
  RECENT_EVENTS_KEY,
  appendRecentEvent,
  buildContextBootstrapEnvelope,
  buildNavigationCommittedEnvelope,
  buildTabActivatedEnvelope,
  defaultCaptureState,
} from "./core/moriBrowserExtensionCore.js";
import {
  TRANSPORT_STATE_KEY,
  createNativeMessagingClient,
} from "./transport/nativeMessagingClient.js";

export function createMoriBrowserBackground({
  runtimeApi = globalThis.chrome,
  nativeTransport = createNativeMessagingClient({ runtimeApi }),
  debugLog = console.debug,
} = {}) {
  async function initialize() {
    const state = await readCaptureState();
    if (typeof state.captureEnabled !== "boolean") {
      await writeCaptureState(defaultCaptureState());
    }
    await writeTransportStatus();
  }

  async function handleStartup() {
    if (await isCaptureEnabled()) {
      nativeTransport.connect();
      await bootstrapContext("startup", { transmit: true });
    }
  }

  async function handleTabActivated(activeInfo) {
    if (!(await isCaptureEnabled())) return;
    const tab = await safeGetTab(activeInfo.tabId);
    const window = await safeGetWindow(activeInfo.windowId);
    const envelope = buildTabActivatedEnvelope({
      manifest: runtimeApi.runtime.getManifest(),
      activeInfo,
      tab,
      window,
    });
    if (envelope) await recordObservation(envelope);
  }

  async function handleNavigationCommitted(details) {
    if (!(await isCaptureEnabled())) return;
    const tab = await safeGetTab(details.tabId);
    const window = tab?.windowId !== undefined ? await safeGetWindow(tab.windowId) : undefined;
    const envelope = buildNavigationCommittedEnvelope({
      manifest: runtimeApi.runtime.getManifest(),
      details,
      tab,
      window,
    });
    if (envelope) await recordObservation(envelope);
  }

  async function handleMessage(message) {
    switch (message?.type) {
      case "mori.browser.get_state":
        return { ok: true, state: await readDebugState() };
      case "mori.browser.set_capture_enabled":
        await setCaptureEnabled(message.enabled === true);
        return { ok: true, state: await readDebugState() };
      case "mori.browser.bootstrap_context":
        return {
          ok: true,
          snapshot: await bootstrapContext("manual", { transmit: await isCaptureEnabled() }),
        };
      default:
        return { ok: false, error: "Unknown Mori browser message." };
    }
  }

  async function setCaptureEnabled(enabled) {
    await writeCaptureState({
      captureEnabled: enabled,
      options: { ...DEFAULT_CAPTURE_OPTIONS },
    });
    if (enabled) {
      nativeTransport.connect();
      await bootstrapContext("enabled", { transmit: true });
    } else {
      nativeTransport.disconnect();
      await writeSessionState({
        [LAST_SNAPSHOT_KEY]: null,
        [RECENT_EVENTS_KEY]: [],
        [TRANSPORT_STATE_KEY]: nativeTransport.getStatus(),
      });
    }
  }

  async function bootstrapContext(reason, { transmit } = { transmit: false }) {
    const windows = await runtimeApi.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const observedAt = new Date().toISOString();
    const snapshot = buildContextBootstrapEnvelope({
      manifest: runtimeApi.runtime.getManifest(),
      windows,
      observedAt,
    });
    await writeSessionState({
      [LAST_SNAPSHOT_KEY]: {
        ...snapshot,
        reason,
      },
    });
    if (transmit) await transmitObservation(snapshot);
    return snapshot;
  }

  async function readCaptureState() {
    const values = await runtimeApi.storage.local.get(CAPTURE_STATE_KEY);
    return values[CAPTURE_STATE_KEY] || defaultCaptureState();
  }

  async function writeCaptureState(state) {
    await runtimeApi.storage.local.set({ [CAPTURE_STATE_KEY]: state });
  }

  async function isCaptureEnabled() {
    const state = await readCaptureState();
    return state.captureEnabled === true;
  }

  async function readDebugState() {
    const [capture, session] = await Promise.all([
      readCaptureState(),
      runtimeApi.storage.session.get([LAST_SNAPSHOT_KEY, RECENT_EVENTS_KEY, TRANSPORT_STATE_KEY]),
    ]);
    return {
      captureEnabled: capture.captureEnabled === true,
      options: capture.options || DEFAULT_CAPTURE_OPTIONS,
      lastSnapshot: session[LAST_SNAPSHOT_KEY] || null,
      recentEvents: session[RECENT_EVENTS_KEY] || [],
      transport: nativeTransport.getStatus(),
    };
  }

  async function writeSessionState(values) {
    await runtimeApi.storage.session.set(values);
  }

  async function writeTransportStatus() {
    await writeSessionState({ [TRANSPORT_STATE_KEY]: nativeTransport.getStatus() });
  }

  async function recordObservation(event) {
    const values = await runtimeApi.storage.session.get(RECENT_EVENTS_KEY);
    await writeSessionState({
      [RECENT_EVENTS_KEY]: appendRecentEvent(values[RECENT_EVENTS_KEY], event),
    });
    await transmitObservation(event);
    debugLog("[Mori Browser Extension]", event.source, event.kind, event);
  }

  async function transmitObservation(envelope) {
    const result = await nativeTransport.sendObservation(envelope);
    await writeTransportStatus();
    return result;
  }

  async function safeGetTab(tabId) {
    try {
      return await runtimeApi.tabs.get(tabId);
    } catch {
      return undefined;
    }
  }

  async function safeGetWindow(windowId) {
    try {
      return await runtimeApi.windows.get(windowId, { populate: false });
    } catch {
      return undefined;
    }
  }

  return {
    handleMessage,
    handleNavigationCommitted,
    handleStartup,
    handleTabActivated,
    initialize,
    readDebugState,
    setCaptureEnabled,
  };
}

export function installMoriBrowserBackground({
  runtimeApi = globalThis.chrome,
  controller = createMoriBrowserBackground({ runtimeApi }),
} = {}) {
  runtimeApi.runtime.onInstalled.addListener(() => {
    void controller.initialize();
  });

  runtimeApi.runtime.onStartup.addListener(() => {
    void controller.handleStartup();
  });

  runtimeApi.tabs.onActivated.addListener((activeInfo) => {
    void controller.handleTabActivated(activeInfo);
  });

  runtimeApi.webNavigation.onCommitted.addListener((details) => {
    void controller.handleNavigationCommitted(details);
  });

  runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    controller
      .handleMessage(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  });

  return controller;
}
