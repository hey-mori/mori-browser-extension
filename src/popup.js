import { projectPopupState } from "./popupState.js";

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
  snapshotStatus.textContent = snapshot ? `Snapshot: ${windows} windows, ${tabs} tabs` : "Snapshot: none";
  eventStatus.textContent = `Events: ${state.recentEvents?.length ?? 0}`;
  const projection = projectPopupState(state);
  transportStatus.textContent = projection.status;
  transportStatus.dataset.tone = projection.tone;
  transportDetail.textContent = projection.detail;
}

function showUnavailable() {
  transportStatus.textContent = "Browser state unavailable";
  transportDetail.textContent = "Reopen the extension popup.";
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
