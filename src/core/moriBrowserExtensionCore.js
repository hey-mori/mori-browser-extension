export const OBSERVATION_PROTOCOL_VERSION = 1;
export const OBSERVATION_SOURCE = "browser";
export const CAPTURE_STATE_KEY = "mori.browserTrace.captureEnabled";
export const LAST_SNAPSHOT_KEY = "mori.browserTrace.lastSnapshot";
export const RECENT_EVENTS_KEY = "mori.browserTrace.recentEvents";
export const MAX_RECENT_EVENTS = 20;

export const DEFAULT_CAPTURE_OPTIONS = Object.freeze({
  captureTitles: false,
  urlDetailPolicy: "origin-path",
});

const INTERNAL_SCHEMES = new Set([
  "about:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "moz-extension:",
  "safari-extension:",
]);

const NAVIGATION_TRANSITION_TYPES = new Set([
  "auto_bookmark",
  "auto_subframe",
  "form_submit",
  "generated",
  "keyword",
  "keyword_generated",
  "link",
  "manual_subframe",
  "reload",
  "start_page",
  "typed",
]);

const NAVIGATION_TRANSITION_QUALIFIERS = new Set([
  "client_redirect",
  "forward_back",
  "from_address_bar",
  "server_redirect",
]);

export function defaultCaptureState() {
  return {
    captureEnabled: false,
    options: { ...DEFAULT_CAPTURE_OPTIONS },
  };
}

export function sanitizeBrowserUrl(rawUrl, policy = DEFAULT_CAPTURE_OPTIONS.urlDetailPolicy) {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed) {
    return { url: "about:blank", internal: true, queryCaptured: false, fragmentCaptured: false };
  }

  try {
    const parsed = new URL(trimmed);
    const internal = INTERNAL_SCHEMES.has(parsed.protocol) || !["http:", "https:"].includes(parsed.protocol);
    parsed.username = "";
    parsed.password = "";

    if (policy === "origin") {
      return {
        url: parsed.origin === "null" ? parsed.protocol : parsed.origin,
        origin: parsed.origin === "null" ? undefined : parsed.origin,
        internal,
        queryCaptured: false,
        fragmentCaptured: false,
      };
    }

    if (policy === "origin-path") {
      parsed.search = "";
      parsed.hash = "";
    }

    return {
      url: parsed.toString(),
      origin: parsed.origin === "null" ? undefined : parsed.origin,
      internal,
      queryCaptured: policy === "full-without-credentials" && parsed.search.length > 0,
      fragmentCaptured: policy === "full-without-credentials" && parsed.hash.length > 0,
    };
  } catch {
    return {
      url: trimmed.split(/[?#]/, 1)[0] || "about:blank",
      internal: true,
      queryCaptured: false,
      fragmentCaptured: false,
    };
  }
}

export function shouldCaptureBrowserUrl(rawUrl) {
  const sanitized = sanitizeBrowserUrl(rawUrl);
  return !sanitized.internal;
}

export function sanitizeTab(tab, options = DEFAULT_CAPTURE_OPTIONS) {
  if (!tab || typeof tab !== "object") return null;
  if (tab.incognito === true) return null;
  const rawUrl = tab.url || tab.pendingUrl || "";
  if (rawUrl && !shouldCaptureBrowserUrl(rawUrl)) return null;
  const sanitized = rawUrl ? sanitizeBrowserUrl(rawUrl, options.urlDetailPolicy) : null;
  return compactObject({
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active === true,
    title: options.captureTitles ? tab.title : undefined,
    url: sanitized?.url,
    pinned: tab.pinned,
    audible: tab.audible,
    status: tab.status,
  });
}

export function sanitizeWindow(window, options = DEFAULT_CAPTURE_OPTIONS) {
  if (!window || typeof window !== "object") return null;
  if (window.incognito === true) return null;
  const tabs = (window.tabs || []).map((tab) => sanitizeTab(tab, options)).filter(Boolean);
  return compactObject({
    id: window.id,
    focused: window.focused === true,
    state: window.state,
    incognito: false,
    tabs,
  });
}

export function buildRuntimeInput(manifest, now = new Date().toISOString()) {
  return compactObject({
    provider: "chrome",
    label: "Chromium",
    installationId: manifest?.name || "mori-browser-extension",
    version: manifest?.version,
    observedAt: now,
  });
}

export function buildContextBootstrapEnvelope({
  manifest,
  windows,
  observedAt = new Date().toISOString(),
  options = DEFAULT_CAPTURE_OPTIONS,
}) {
  return browserObservationEnvelope({
    kind: "context_snapshot",
    observedAt,
    payload: {
      runtime: buildRuntimeInput(manifest, observedAt),
      windows: windows.map((window) => sanitizeWindow(window, options)).filter(Boolean),
      urlDetailPolicy: options.urlDetailPolicy,
    },
  });
}

export function buildTabActivatedEnvelope({
  manifest,
  activeInfo,
  tab,
  window,
  occurredAt = new Date().toISOString(),
  options = DEFAULT_CAPTURE_OPTIONS,
}) {
  const sanitizedTab = sanitizeTab({ ...tab, id: activeInfo.tabId, windowId: activeInfo.windowId, active: true }, options);
  if (!sanitizedTab) return null;
  return browserObservationEnvelope({
    kind: "tab_activated",
    observedAt: occurredAt,
    payload: {
      runtime: buildRuntimeInput(manifest, occurredAt),
      activeInfo,
      tab: sanitizedTab,
      window: sanitizeWindow({ ...window, id: activeInfo.windowId, focused: window?.focused }, options) || {
        id: activeInfo.windowId,
        focused: false,
        tabs: [],
      },
      urlDetailPolicy: options.urlDetailPolicy,
    },
  });
}

export function buildNavigationCommittedEnvelope({
  manifest,
  details,
  tab,
  window,
  options = DEFAULT_CAPTURE_OPTIONS,
}) {
  return buildNavigationEnvelope({
    kind: "navigation_committed",
    manifest,
    details,
    tab,
    window,
    options,
  });
}

export function buildHistoryStateUpdatedEnvelope({
  manifest,
  details,
  tab,
  window,
  options = DEFAULT_CAPTURE_OPTIONS,
}) {
  return buildNavigationEnvelope({
    kind: "history_state_updated",
    manifest,
    details,
    tab,
    window,
    options,
  });
}

function buildNavigationEnvelope({ kind, manifest, details, tab, window, options }) {
  if (details?.frameId !== undefined && details.frameId !== 0) return null;
  if (!shouldCaptureBrowserUrl(details?.url)) return null;
  const occurredAt =
    typeof details.timeStamp === "number" && Number.isFinite(details.timeStamp)
      ? new Date(details.timeStamp).toISOString()
      : new Date().toISOString();
  const sanitizedUrl = sanitizeBrowserUrl(details.url, options.urlDetailPolicy);
  const sanitizedTab = sanitizeTab({ ...tab, id: details.tabId, url: sanitizedUrl.url }, options) || {
    id: details.tabId,
    windowId: tab?.windowId ?? window?.id,
    active: tab?.active === true,
    url: sanitizedUrl.url,
  };

  return browserObservationEnvelope({
    kind,
    observedAt: occurredAt,
    payload: {
      runtime: buildRuntimeInput(manifest, occurredAt),
      details: compactObject({
        tabId: details.tabId,
        url: sanitizedUrl.url,
        timeStamp: Date.parse(occurredAt),
        transitionType: NAVIGATION_TRANSITION_TYPES.has(details.transitionType)
          ? details.transitionType
          : undefined,
        transitionQualifiers: Array.isArray(details.transitionQualifiers)
          ? details.transitionQualifiers.filter((qualifier) =>
              NAVIGATION_TRANSITION_QUALIFIERS.has(qualifier),
            )
          : [],
      }),
      tab: sanitizedTab,
      window: window ? sanitizeWindow(window, options) : undefined,
      urlDetailPolicy: options.urlDetailPolicy,
    },
  });
}

export function appendRecentEvent(existing, event, limit = MAX_RECENT_EVENTS) {
  return [event, ...(Array.isArray(existing) ? existing : [])].slice(0, limit);
}

function browserObservationEnvelope({ kind, observedAt, payload }) {
  return {
    version: OBSERVATION_PROTOCOL_VERSION,
    source: OBSERVATION_SOURCE,
    kind,
    observedAt,
    payload: compactObject(payload),
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
