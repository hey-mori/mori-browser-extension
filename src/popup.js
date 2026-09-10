const toggle = document.querySelector("#capture-toggle");
const snapshotStatus = document.querySelector("#snapshot-status");
const eventStatus = document.querySelector("#event-status");
const transportStatus = document.querySelector("#transport-status");
const bootstrapButton = document.querySelector("#bootstrap-button");

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refresh() {
  const response = await send({ type: "mori.browser.get_state" });
  if (!response?.ok) return;
  const state = response.state;
  toggle.checked = state.captureEnabled === true;
  const snapshot = state.lastSnapshot;
  const windows = snapshot?.payload?.windows?.length ?? 0;
  const tabs =
    snapshot?.payload?.windows?.reduce((count, window) => count + (window.tabs?.length ?? 0), 0) ?? 0;
  snapshotStatus.textContent = snapshot ? `Snapshot: ${windows} windows, ${tabs} tabs` : "Snapshot: none";
  eventStatus.textContent = `Events: ${state.recentEvents?.length ?? 0}`;
  transportStatus.textContent = transportLabel(state.transport);
}

toggle.addEventListener("change", async () => {
  await send({ type: "mori.browser.set_capture_enabled", enabled: toggle.checked });
  await refresh();
});

bootstrapButton.addEventListener("click", async () => {
  await send({ type: "mori.browser.bootstrap_context" });
  await refresh();
});

refresh().catch(() => {
  snapshotStatus.textContent = "Snapshot: unavailable";
});

function transportLabel(transport) {
  const state = transport?.state || "disconnected";
  const detail =
    transport?.lastError?.message ||
    transport?.lastAcknowledgement?.code ||
    transport?.lastAcknowledgement?.kind ||
    "";
  return detail ? `Mori: ${state} (${detail})` : `Mori: ${state}`;
}
