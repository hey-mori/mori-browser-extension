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

const runtimeApi = globalThis.chrome;

runtimeApi.runtime.onInstalled.addListener(async () => {
  const state = await readCaptureState();
  if (typeof state.captureEnabled !== "boolean") {
    await writeCaptureState(defaultCaptureState());
  }
});

runtimeApi.runtime.onStartup.addListener(async () => {
  if (await isCaptureEnabled()) {
    await bootstrapContext("startup");
  }
});

runtimeApi.tabs.onActivated.addListener(async (activeInfo) => {
  if (!(await isCaptureEnabled())) return;
  const tab = await safeGetTab(activeInfo.tabId);
  const window = await safeGetWindow(activeInfo.windowId);
  const envelope = buildTabActivatedEnvelope({
    manifest: runtimeApi.runtime.getManifest(),
    activeInfo,
    tab,
    window,
  });
  if (envelope) await recordDebugEvent(envelope);
});

runtimeApi.webNavigation.onCommitted.addListener(async (details) => {
  if (!(await isCaptureEnabled())) return;
  const tab = await safeGetTab(details.tabId);
  const window = tab?.windowId !== undefined ? await safeGetWindow(tab.windowId) : undefined;
  const envelope = buildNavigationCommittedEnvelope({
    manifest: runtimeApi.runtime.getManifest(),
    details,
    tab,
    window,
  });
  if (envelope) await recordDebugEvent(envelope);
});

runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "mori.browser.get_state":
      return { ok: true, state: await readDebugState() };
    case "mori.browser.set_capture_enabled":
      await setCaptureEnabled(message.enabled === true);
      return { ok: true, state: await readDebugState() };
    case "mori.browser.bootstrap_context":
      return { ok: true, snapshot: await bootstrapContext("manual") };
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
    await bootstrapContext("enabled");
  } else {
    await writeSessionState({ [LAST_SNAPSHOT_KEY]: null, [RECENT_EVENTS_KEY]: [] });
  }
}

async function bootstrapContext(reason) {
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
    runtimeApi.storage.session.get([LAST_SNAPSHOT_KEY, RECENT_EVENTS_KEY]),
  ]);
  return {
    captureEnabled: capture.captureEnabled === true,
    options: capture.options || DEFAULT_CAPTURE_OPTIONS,
    lastSnapshot: session[LAST_SNAPSHOT_KEY] || null,
    recentEvents: session[RECENT_EVENTS_KEY] || [],
    transport: "extension-local-debug",
  };
}

async function writeSessionState(values) {
  await runtimeApi.storage.session.set(values);
}

async function recordDebugEvent(event) {
  const values = await runtimeApi.storage.session.get(RECENT_EVENTS_KEY);
  await writeSessionState({
    [RECENT_EVENTS_KEY]: appendRecentEvent(values[RECENT_EVENTS_KEY], event),
  });
  console.debug("[Mori Browser Extension]", event.source, event.kind, event);
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
