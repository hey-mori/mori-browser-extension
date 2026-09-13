export function projectPopupState(state, now = Date.now()) {
  if (!state?.captureEnabled) return { status: "Capture off", detail: "", tone: "quiet" };
  const transport = state.transport;
  const code = transport?.lastError?.code;
  if (code === "mori_unavailable") return {
    status: "Mori isn't running", detail: "Open Mori Desktop to resume delivery.", tone: "quiet",
  };
  if (["native_host_unavailable", "native_host_disconnected", "connect_failed"].includes(code)) return {
    status: "Browser integration unavailable", detail: "Check the Mori Desktop installation.", tone: "warning",
  };
  if (code) return {
    status: code === "persistence_failed" ? "Mori couldn't save activity" : "Delivery interrupted",
    detail: "Delivery resumes with your next browser activity.", tone: "warning",
  };
  if (transport?.pending > 0) return { status: "Sending to Mori", detail: "", tone: "quiet" };
  if (transport?.lastAcknowledgement?.ok && now - Date.parse(transport.updatedAt) < 60_000) return {
    status: "Mori connected", detail: "Last delivery confirmed.", tone: "ok",
  };
  return { status: "Waiting for browser activity", detail: "Connection is checked on the next delivery.", tone: "quiet" };
}
