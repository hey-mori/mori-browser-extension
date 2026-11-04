// What the popup says about capture and delivery, as message keys from
// _locales/*/messages.json, so the words follow the browser's language.
export function projectPopupState(state, now = Date.now()) {
  if (!state?.captureEnabled) return { status: "statusCaptureOff", detail: "", tone: "quiet" };
  const transport = state.transport;
  const code = transport?.lastError?.code;
  if (code === "mori_unavailable") return {
    status: "statusMoriNotRunning", detail: "detailMoriNotRunning", tone: "quiet",
  };
  if (["native_host_unavailable", "native_host_disconnected", "connect_failed"].includes(code)) return {
    status: "statusIntegrationUnavailable", detail: "detailIntegrationUnavailable", tone: "warning",
  };
  if (code) return {
    status: code === "persistence_failed" ? "statusSaveFailed" : "statusDeliveryInterrupted",
    detail: "detailDeliveryResumes", tone: "warning",
  };
  if (transport?.pending > 0) return { status: "statusSending", detail: "", tone: "quiet" };
  if (transport?.lastAcknowledgement?.ok && now - Date.parse(transport.updatedAt) < 60_000) return {
    status: "statusConnected", detail: "detailConnected", tone: "ok",
  };
  return { status: "statusWaiting", detail: "detailWaiting", tone: "quiet" };
}
