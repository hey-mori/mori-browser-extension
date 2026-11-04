import { projectPopupState } from "./popupState.js";

// The text is in _locales; the English in popup.html is only what shows if a
// key is missing. chrome.i18n picks the catalog from the browser's language.
function message(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

document.documentElement.lang = chrome.i18n.getUILanguage();
for (const element of document.querySelectorAll("[data-i18n]")) {
  const text = chrome.i18n.getMessage(element.dataset.i18n);
  if (text) element.textContent = text;
}
for (const element of document.querySelectorAll("[data-i18n-aria]")) {
  const text = chrome.i18n.getMessage(element.dataset.i18nAria);
  if (text) element.setAttribute("aria-label", text);
}

const toggle = document.querySelector("#capture-toggle");
const snapshotStatus = document.querySelector("#snapshot-status");
const eventStatus = document.querySelector("#event-status");
const transportStatus = document.querySelector("#transport-status");
const transportDetail = document.querySelector("#transport-detail");
const bootstrapButton = document.querySelector("#bootstrap-button");
let busy = false;

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "mori.browser.get_state" });
  if (!response?.ok) throw new Error("State unavailable");
  const state = response.state;
  if (!busy) toggle.checked = state.captureEnabled === true;
  bootstrapButton.disabled = busy || !state.captureEnabled;
  const snapshot = state.lastSnapshot;
  const windows = snapshot?.payload?.windows?.length ?? 0;
  const tabs = snapshot?.payload?.windows?.reduce((count, window) => count + (window.tabs?.length ?? 0), 0) ?? 0;
  snapshotStatus.textContent = snapshot
    ? message("snapshotCounts", [String(windows), String(tabs)])
    : message("snapshotNone");
  eventStatus.textContent = message("eventCount", [String(state.recentEvents?.length ?? 0)]);
  const projection = projectPopupState(state);
  transportStatus.textContent = message(projection.status);
  transportStatus.dataset.tone = projection.tone;
  transportDetail.textContent = projection.detail ? message(projection.detail) : "";
}

function showUnavailable() {
  transportStatus.textContent = message("statusUnavailable");
  transportDetail.textContent = message("detailUnavailable");
}

async function command(message) {
  busy = true;
  toggle.disabled = true;
  bootstrapButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error("Command failed");
  } catch { showUnavailable(); }
  finally {
    busy = false;
    toggle.disabled = false;
    await refresh().catch(showUnavailable);
  }
}

toggle.addEventListener("change", () => void command({ type: "mori.browser.set_capture_enabled", enabled: toggle.checked }));
bootstrapButton.addEventListener("click", () => void command({ type: "mori.browser.bootstrap_context" }));
chrome.storage.onChanged.addListener(() => { if (!busy) void refresh().catch(showUnavailable); });
const refreshTimer = setInterval(() => { if (!busy) void refresh().catch(showUnavailable); }, 5000);
window.addEventListener("unload", () => clearInterval(refreshTimer));
void refresh().catch(showUnavailable);
