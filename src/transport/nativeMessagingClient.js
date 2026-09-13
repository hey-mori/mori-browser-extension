export const MORI_BROWSER_NATIVE_HOST_NAME = "com.swarea.mori.browser";
export const TRANSPORT_STATE_KEY = "mori.browserTrace.nativeMessaging";
export const MAX_PENDING_OBSERVATIONS = 32;

const DEFAULT_ERROR = Object.freeze({
  code: "not_connected",
  message: "Native Messaging is not connected.",
});

export function createNativeMessagingClient({
  runtimeApi = globalThis.chrome,
  hostName = MORI_BROWSER_NATIVE_HOST_NAME,
  now = () => new Date().toISOString(),
  onStatusChange = () => undefined,
  acknowledgementTimeoutMs = 10_000,
} = {}) {
  let port = null;
  let pending = [];
  let intentionalDisconnect = false;
  let status = nextStatus({
    hostName,
    state: "disconnected",
    lastError: null,
    lastAcknowledgement: null,
    pending: 0,
    now,
  });

  function getStatus() {
    return { ...status };
  }

  function setStatus(update) {
    status = nextStatus({ ...status, ...update, hostName, pending: pending.length, now });
    onStatusChange(getStatus());
  }

  function connect() {
    if (port) return port;
    try {
      port = runtimeApi.runtime.connectNative(hostName);
      intentionalDisconnect = false;
      const connectedPort = port;
      port.onMessage.addListener((message) => { if (port === connectedPort) handleMessage(message); });
      port.onDisconnect.addListener(() => { if (port === connectedPort) handleDisconnect(); });
      setStatus({ state: "connected", lastError: null });
      return port;
    } catch (error) {
      setStatus({
        state: "error",
        lastError: transportError("connect_failed", error),
      });
      return null;
    }
  }

  function disconnect() {
    const activePort = port;
    port = null;
    intentionalDisconnect = true;
    rejectPending({
      ok: false,
      code: "transport_disabled",
      message: "Browser capture was disabled before the native host acknowledged the observation.",
    });
    if (activePort) {
      try {
        activePort.disconnect();
      } catch {
        // The browser may have already torn the port down.
      }
    }
    setStatus({ state: "disconnected", lastError: null });
  }

  async function sendObservation(observation) {
    if (pending.length >= MAX_PENDING_OBSERVATIONS) {
      const acknowledgement = { ok: false, code: "backpressure", message: "Mori delivery is busy." };
      setStatus({ state: "error", lastError: acknowledgement, lastAcknowledgement: acknowledgement });
      return { ok: false, acknowledgement };
    }
    const activePort = connect();
    if (!activePort) {
      const acknowledgement = {
        ok: false,
        code: "native_host_unavailable",
        message: status.lastError?.message || DEFAULT_ERROR.message,
      };
      return { ok: false, acknowledgement };
    }

    return new Promise((resolve) => {
      const finish = (result) => { clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => {
        // FIFO has no wire request id. Drop the port so late ACKs cannot match a new send.
        const acknowledgement = { ok: false, code: "mori_timeout", message: "Mori did not respond in time." };
        rejectPending(acknowledgement);
        disconnect();
        setStatus({ state: "error", lastError: acknowledgement, lastAcknowledgement: acknowledgement });
      }, acknowledgementTimeoutMs);
      pending.push(finish);
      setStatus({ pending: pending.length });
      try {
        activePort.postMessage(observation);
      } catch (error) {
        removePending(finish);
        const acknowledgement = {
          ok: false,
          code: "post_message_failed",
          message: error instanceof Error ? error.message : String(error),
        };
        setStatus({
          state: "error",
          lastError: { code: acknowledgement.code, message: acknowledgement.message },
          lastAcknowledgement: acknowledgement,
        });
        finish({ ok: false, acknowledgement });
      }
    });
  }

  function handleMessage(message) {
    const acknowledgement = normalizeAcknowledgement(message);
    const resolve = pending.shift();
    setStatus({
      state: acknowledgement.ok
        ? "connected"
        : acknowledgement.code === "mori_unavailable"
          ? "mori_unavailable"
          : "error",
      lastError: acknowledgement.ok
        ? null
        : { code: acknowledgement.code || "native_host_error", message: acknowledgement.message || "Native host rejected the observation." },
      lastAcknowledgement: acknowledgement,
    });
    if (resolve) resolve({ ok: acknowledgement.ok === true, acknowledgement });
  }

  function handleDisconnect() {
    if (intentionalDisconnect) {
      intentionalDisconnect = false;
      setStatus({ state: "disconnected", lastError: null });
      return;
    }

    const error = runtimeApi.runtime.lastError
      ? { code: "native_host_disconnected", message: runtimeApi.runtime.lastError.message }
      : { code: "native_host_disconnected", message: "Native host disconnected." };
    port = null;
    const acknowledgement = { ok: false, code: error.code, message: error.message };
    rejectPending(acknowledgement);
    setStatus({ state: "disconnected", lastError: error, lastAcknowledgement: acknowledgement });
  }

  function rejectPending(acknowledgement) {
    const waiting = pending;
    pending = [];
    for (const resolve of waiting) {
      resolve({ ok: false, acknowledgement });
    }
  }

  function removePending(resolve) {
    pending = pending.filter((entry) => entry !== resolve);
  }

  return {
    connect,
    disconnect,
    getStatus,
    sendObservation,
  };
}

function nextStatus({ hostName, state, lastError, lastAcknowledgement, pending, now }) {
  return {
    hostName,
    state,
    connected: state === "connected" || state === "mori_unavailable",
    pending,
    lastError,
    lastAcknowledgement,
    updatedAt: now(),
  };
}

function normalizeAcknowledgement(message) {
  if (message && typeof message === "object" && "ok" in message) return message;
  return {
    ok: false,
    code: "invalid_ack",
    message: "Native host returned an invalid acknowledgement.",
  };
}

function transportError(code, error) {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
