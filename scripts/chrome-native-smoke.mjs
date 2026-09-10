#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRequiredSmokeResult,
  buildInstallNativeHostCommand,
  buildNativeHostAllowedOrigin,
  chromeNativeHostRegistryPath,
  createSmokeResult,
  makeTempProfilePrefix,
  nativeHostManifestPath,
  parseChromeVersion,
  parseSmokeArgs,
  readDevToolsActivePort,
  resolveSmokePaths,
  usage,
  validatePrerequisites,
} from "./lib/chromeNativeSmokeSupport.mjs";

const CAPTURE_STATE_KEY = "mori.browserTrace.captureEnabled";
const LAST_SNAPSHOT_KEY = "mori.browserTrace.lastSnapshot";
const RECENT_EVENTS_KEY = "mori.browserTrace.recentEvents";
const TRANSPORT_STATE_KEY = "mori.browserTrace.nativeMessaging";
const SENSITIVE_NAVIGATION_URL = "https://example.com/on?token=secret#hidden";
const SANITIZED_NAVIGATION_URL = "https://example.com/on";
const AFTER_OFF_URL = "https://example.com/after-off?token=later#hidden";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, "..");

async function main() {
  const options = parseSmokeArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const paths = resolveSmokePaths({ extensionRoot, ...options });
  validatePrerequisites(paths);

  const result = createSmokeResult();
  result.chromeExecutable = paths.chromePath;
  result.chromeVersion = getChromeVersion(paths.chromePath);

  const registry = new NativeHostRegistry("chrome");

  try {
    log("Chrome Native Messaging smoke");
    log(`Chrome executable: ${result.chromeExecutable}`);
    log(`Chrome version before CDP: ${result.chromeVersion}`);
    log(`Extension root: ${paths.extensionRoot}`);
    log(`Mori worktree: ${paths.moriWorktree}`);
    log(`Native host: ${paths.nativeHostPath}`);

    await runHappyPath({ options, paths, registry, result });

    if (options.skipMoriUnavailable) {
      result.skipped.push("moriUnavailable");
    } else {
      await runMoriUnavailablePath({ options, paths, registry, result });
    }

    if (options.skipHostMissing) {
      result.skipped.push("hostMissing");
    } else {
      await runHostMissingPath({ options, paths, registry, result });
    }

    assertRequiredSmokeResult(result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

async function runHappyPath({ options, paths, registry, result }) {
  log("Starting happy-path Chrome profile");
  await withChrome(paths.chromePath, { ...options, result }, async (chrome) => {
    Object.assign(result, await chromeCapabilities(chrome.cdp));

    const extensionId = await loadExtension(chrome.cdp, paths.extensionRoot);
    result.extensionLoaded = true;
    result.extensionId = extensionId;
    log(`Loaded unpacked extension id: ${extensionId}`);

    await registry.withInstalledHost(
      {
        extensionId,
        manifestPath: nativeHostManifestPath(chrome.profileDir),
        paths,
      },
      async () => {
        result.hostRegistered = true;

        const popup = await openExtensionPopup(chrome.cdp, extensionId);
        const onState = await setCaptureFromPopup(chrome.cdp, popup.sessionId, true);
        result.popupOptIn = onState.checked === true;

        await waitForStorage(chrome.cdp, popup.sessionId, (state) => {
          const snapshot = state.session[LAST_SNAPSHOT_KEY];
          const transport = state.session[TRANSPORT_STATE_KEY];
          return snapshot?.kind === "context_snapshot" &&
            transport?.lastAcknowledgement?.kind === "context_snapshot" &&
            transport?.lastAcknowledgement?.route === "context";
        }, "context_snapshot acknowledgement", { timeoutMs: 20000 });
        result.contextSnapshot = true;

        await triggerNavigation(chrome.cdp, SENSITIVE_NAVIGATION_URL);
        const navigationState = await waitForStorage(chrome.cdp, popup.sessionId, (state) => {
          return findRecentEvent(state, "navigation_committed", (event) => {
            return event.payload?.details?.url === SANITIZED_NAVIGATION_URL &&
              state.session[TRANSPORT_STATE_KEY]?.lastAcknowledgement?.kind ===
                "navigation_committed" &&
              state.session[TRANSPORT_STATE_KEY]?.lastAcknowledgement?.route === "trace";
          });
        }, "navigation_committed acknowledgement");
        result.navigationCommitted = true;
        result.urlSanitized = storageText(navigationState).includes(SANITIZED_NAVIGATION_URL) &&
          !storageText(navigationState).includes("token=secret") &&
          !storageText(navigationState).includes("#hidden");

        await triggerTabActivation(chrome.cdp);
        await waitForStorage(chrome.cdp, popup.sessionId, (state) => {
          return findRecentEvent(state, "tab_activated", (event) => {
            return state.session[TRANSPORT_STATE_KEY]?.lastAcknowledgement?.kind ===
              "tab_activated" && typeof event.payload?.activeInfo?.tabId !== "undefined";
          });
        }, "tab_activated acknowledgement");
        result.tabActivated = true;

        const offState = await setCaptureFromPopup(chrome.cdp, popup.sessionId, false);
        if (offState.checked !== false) throw new Error("Popup did not turn capture off.");
        await triggerNavigation(chrome.cdp, AFTER_OFF_URL);
        await sleep(750);
        const afterOffState = await readExtensionStorage(chrome.cdp, popup.sessionId);
        result.captureOffBlocked =
          afterOffState.local[CAPTURE_STATE_KEY]?.captureEnabled === false &&
          !storageText(afterOffState).includes("after-off") &&
          !storageText(afterOffState).includes("token=later") &&
          !storageText(afterOffState).includes("#hidden") &&
          afterOffState.session[TRANSPORT_STATE_KEY]?.state === "disconnected" &&
          afterOffState.session[TRANSPORT_STATE_KEY]?.lastError === null;
        if (!result.captureOffBlocked) {
          log(`Capture-off state: ${JSON.stringify(afterOffState)}`);
        }
      },
    );
  });
}

async function runMoriUnavailablePath({ options, paths, registry, result }) {
  log("Starting Mori-unavailable failure profile");
  const unavailableRelayName = `mori-browser-smoke-unavailable-${Date.now()}-${process.pid}`;
  await withChrome(
    paths.chromePath,
    {
      ...options,
      result,
      chromeEnv: { MORI_BROWSER_RELAY_NAME: unavailableRelayName },
    },
    async (chrome) => {
      const extensionId = await loadExtension(chrome.cdp, paths.extensionRoot);
      await registry.withInstalledHost(
        {
          extensionId,
          manifestPath: nativeHostManifestPath(chrome.profileDir),
          paths,
        },
        async () => {
          const popup = await openExtensionPopup(chrome.cdp, extensionId);
          await setCaptureFromPopup(chrome.cdp, popup.sessionId, true);
          await triggerNavigation(chrome.cdp, "https://example.com/unavailable?token=secret#hidden");
          await waitForStorage(chrome.cdp, popup.sessionId, (state) => {
            return state.session[TRANSPORT_STATE_KEY]?.state === "mori_unavailable" &&
              state.session[TRANSPORT_STATE_KEY]?.lastError?.code === "mori_unavailable";
          }, "mori_unavailable acknowledgement");
          result.moriUnavailable = true;
        },
      );
    },
  );
}

async function runHostMissingPath({ options, paths, registry, result }) {
  log("Starting host-missing failure profile");
  await registry.withoutRegisteredHost(async () => {
    await withChrome(paths.chromePath, { ...options, result }, async (chrome) => {
      const extensionId = await loadExtension(chrome.cdp, paths.extensionRoot);
      const popup = await openExtensionPopup(chrome.cdp, extensionId);
      await setCaptureFromPopup(chrome.cdp, popup.sessionId, true);
      await triggerNavigation(chrome.cdp, "https://example.com/host-missing?token=secret#hidden");
      await waitForStorage(chrome.cdp, popup.sessionId, (state) => {
        const transport = state.session[TRANSPORT_STATE_KEY];
        return ["disconnected", "error"].includes(transport?.state) &&
          ["native_host_disconnected", "connect_failed", "post_message_failed"].includes(
            transport?.lastError?.code,
          );
      }, "host-missing native messaging failure");
      result.hostMissing = true;
    });
  });
}

async function withChrome(chromePath, options, fn) {
  const profileDir = mkdtempSync(makeTempProfilePrefix());
  options.result?.temporaryProfiles?.push(profileDir);
  let chrome = null;

  try {
    chrome = await launchChrome({
      chromePath,
      profileDir,
      env: options.chromeEnv || {},
    });
    chrome.profileDir = profileDir;
    return await fn(chrome);
  } finally {
    await chrome?.close();
    if (!options.keepProfile) {
      removeProfile(profileDir);
    } else {
      log(`Kept temporary profile: ${profileDir}`);
    }
  }
}

async function launchChrome({ chromePath, profileDir, env }) {
  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "about:blank",
    ],
    {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const devToolsFile = path.join(profileDir, "DevToolsActivePort");
  let activePort;
  let cdp;
  try {
    activePort = await waitFor(() => {
      try {
        return readDevToolsActivePort(readFileSync(devToolsFile, "utf8"));
      } catch {
        return null;
      }
    }, "Chrome DevToolsActivePort", {
      timeoutMs: 20000,
      onTimeout() {
        return stderr ? ` Chrome stderr: ${stderr.slice(-1000)}` : "";
      },
    });

    cdp = new CdpConnection(activePort.browserWebSocketUrl);
    await cdp.connect();
  } catch (error) {
    terminateChromeProcess(child);
    throw error;
  }

  return {
    cdp,
    pid: child.pid,
    profileDir,
    async close() {
      await cdp.send("Browser.close").catch(() => undefined);
      cdp.close();
      terminateChromeProcess(child);
      await waitForProcessExit(child, 3000).catch(() => {
        if (process.platform === "win32" && child.pid) {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        }
      });
      if (stderr.includes("--load-extension is not allowed")) {
        log("Chrome reported CLI extension flags are blocked; CDP loader was used instead.");
      }
    },
  };
}

function terminateChromeProcess(child) {
  if (!child.killed && child.exitCode === null) {
    child.kill();
  }
  if (process.platform === "win32" && child.pid && child.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

async function chromeCapabilities(cdp) {
  const version = await cdp.send("Browser.getVersion");
  try {
    await cdp.send("Extensions.getExtensions");
  } catch (error) {
    throw new Error("Unsupported smoke environment: CDP Extensions domain is unavailable.");
  }
  log(`CDP product: ${version.product}`);
  log(`CDP protocol: ${version.protocolVersion}`);
  return {
    chromeVersion: version.product,
    cdpProduct: version.product,
    cdpProtocolVersion: version.protocolVersion,
    extensionsLoadUnpackedAvailable: true,
  };
}

async function loadExtension(cdp, extensionPath) {
  const response = await cdp.send("Extensions.loadUnpacked", {
    path: extensionPath,
    enableInIncognito: false,
  });
  if (!response.id) throw new Error("Extensions.loadUnpacked did not return an extension id.");
  return response.id;
}

async function openExtensionPopup(cdp, extensionId) {
  const target = await cdp.send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/src/popup.html`,
  });
  const attached = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await cdp.send("Runtime.enable", {}, attached.sessionId);
  await waitForPopupReady(cdp, attached.sessionId);
  return { targetId: target.targetId, sessionId: attached.sessionId };
}

async function waitForPopupReady(cdp, sessionId) {
  await waitFor(async () => {
    const value = await evaluate(
      cdp,
      sessionId,
      "document.readyState === 'complete' && Boolean(document.querySelector('#capture-toggle'))",
    );
    return value === true;
  }, "extension popup document");
}

async function setCaptureFromPopup(cdp, sessionId, enabled) {
  const expression = `
    (async () => {
      const toggle = document.querySelector("#capture-toggle");
      if (!toggle) return { ok: false, reason: "missing toggle" };
      if (toggle.checked !== ${enabled ? "true" : "false"}) {
        toggle.click();
      }
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const local = await chrome.storage.local.get("${CAPTURE_STATE_KEY}");
        if (
          toggle.checked === ${enabled ? "true" : "false"} &&
          local["${CAPTURE_STATE_KEY}"]?.captureEnabled === ${enabled ? "true" : "false"}
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const local = await chrome.storage.local.get("${CAPTURE_STATE_KEY}");
      return {
        ok: local["${CAPTURE_STATE_KEY}"]?.captureEnabled === ${enabled ? "true" : "false"},
        checked: toggle.checked,
        capture: local["${CAPTURE_STATE_KEY}"] || null,
        transport: document.querySelector("#transport-status")?.textContent || "",
        snapshot: document.querySelector("#snapshot-status")?.textContent || "",
        events: document.querySelector("#event-status")?.textContent || ""
      };
    })()
  `;
  const value = await evaluate(cdp, sessionId, expression, { awaitPromise: true });
  if (!value?.ok) throw new Error(`Popup capture toggle failed: ${JSON.stringify(value)}`);
  return value;
}

async function triggerNavigation(cdp, url) {
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await cdp.send("Page.enable", {}, attached.sessionId);
  await cdp.send("Page.navigate", { url }, attached.sessionId);
  return target.targetId;
}

async function triggerTabActivation(cdp) {
  const first = await cdp.send("Target.createTarget", { url: "https://example.com/tab-one" });
  const second = await cdp.send("Target.createTarget", { url: "https://example.com/tab-two" });
  await sleep(250);
  await cdp.send("Target.activateTarget", { targetId: first.targetId });
  await sleep(250);
  await cdp.send("Target.activateTarget", { targetId: second.targetId });
  return [first.targetId, second.targetId];
}

async function readExtensionStorage(cdp, sessionId) {
  return evaluate(
    cdp,
    sessionId,
    `
      (async () => {
        const [local, session] = await Promise.all([
          chrome.storage.local.get(null),
          chrome.storage.session.get(null)
        ]);
        return { local, session };
      })()
    `,
    { awaitPromise: true },
  );
}

async function waitForStorage(cdp, sessionId, predicate, label, options = {}) {
  let lastState = null;
  return waitFor(async () => {
    const state = await readExtensionStorage(cdp, sessionId);
    lastState = state;
    return predicate(state) ? state : null;
  }, label, {
    ...options,
    onTimeout() {
      if (lastState) return ` Last storage state: ${JSON.stringify(lastState)}`;
      return "";
    },
  });
}

function findRecentEvent(state, kind, predicate = () => true) {
  const events = state.session[RECENT_EVENTS_KEY] || [];
  return events.find((event) => event.kind === kind && predicate(event));
}

function storageText(value) {
  return JSON.stringify(value);
}

async function evaluate(cdp, sessionId, expression, options = {}) {
  const response = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise === true,
    },
    sessionId,
  );
  if (response.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${response.exceptionDetails.text}`);
  }
  return response.result?.value;
}

function getChromeVersion(chromePath) {
  const result = spawnSync(chromePath, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const parsed = parseChromeVersion(result.stdout || result.stderr || "");
  return parsed && !parsed.includes("�") ? parsed : "unknown";
}

class NativeHostRegistry {
  constructor(browser) {
    this.browser = browser;
    this.registryPath = chromeNativeHostRegistryPath(browser);
  }

  async withInstalledHost({ extensionId, manifestPath, paths }, fn) {
    const previous = this.read();
    try {
      this.install({ extensionId, manifestPath, paths });
      this.verify({ extensionId, manifestPath, paths });
      return await fn();
    } finally {
      this.restore(previous);
    }
  }

  async withoutRegisteredHost(fn) {
    const previous = this.read();
    try {
      this.remove();
      return await fn();
    } finally {
      this.restore(previous);
    }
  }

  install({ extensionId, manifestPath, paths }) {
    const command = buildInstallNativeHostCommand({
      moriWorktree: paths.moriWorktree,
      nativeHostPath: paths.nativeHostPath,
      extensionId,
      manifestPath,
      browser: this.browser,
    });
    run(command.command, command.args, "native host registration");
  }

  verify({ extensionId, manifestPath, paths }) {
    const current = this.read();
    if (current.value !== manifestPath) {
      throw new Error(`Native host registry read-back mismatch: ${current.value}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expectedOrigin = buildNativeHostAllowedOrigin(extensionId);
    if (manifest.name !== "com.swarea.mori.browser") {
      throw new Error(`Native host manifest name mismatch: ${manifest.name}`);
    }
    if (path.resolve(manifest.path) !== path.resolve(paths.nativeHostPath)) {
      throw new Error(`Native host manifest path mismatch: ${manifest.path}`);
    }
    if (!manifest.allowed_origins?.includes(expectedOrigin)) {
      throw new Error(`Native host manifest missing allowed origin: ${expectedOrigin}`);
    }
  }

  read() {
    const script = `
      $path = '${escapePowerShellSingleQuoted(this.registryPath)}'
      if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path
        [pscustomobject]@{ exists = $true; value = [string]$item.GetValue("") } | ConvertTo-Json -Compress
      } else {
        [pscustomobject]@{ exists = $false; value = "" } | ConvertTo-Json -Compress
      }
    `;
    return JSON.parse(run("powershell", ["-NoProfile", "-Command", script], "registry read"));
  }

  remove() {
    const script = `
      $path = '${escapePowerShellSingleQuoted(this.registryPath)}'
      if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
      }
    `;
    run("powershell", ["-NoProfile", "-Command", script], "registry remove");
  }

  restore(previous) {
    if (previous.exists) {
      const script = `
        $path = '${escapePowerShellSingleQuoted(this.registryPath)}'
        $value = '${escapePowerShellSingleQuoted(previous.value)}'
        New-Item -Path $path -Force | Out-Null
        Set-Item -Path $path -Value $value
      `;
      run("powershell", ["-NoProfile", "-Command", script], "registry restore");
    } else {
      this.remove();
    }
  }
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket === "undefined") {
      throw new Error("Node.js WebSocket support is required for the Chrome smoke harness.");
    }
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP socket closed."));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const body = JSON.stringify(message);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(body);
    });
  }

  close() {
    this.socket?.close();
  }

  handleMessage(data) {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message || "CDP error"} (${message.error.code})`));
    } else {
      pending.resolve(message.result || {});
    }
  }
}

async function waitFor(callback, label, { timeoutMs = 10000, intervalMs = 100, onTimeout } = {}) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  const timeoutDetail = typeof onTimeout === "function" ? onTimeout() : "";
  throw new Error(`Timed out waiting for ${label}.${detail}${timeoutDetail}`);
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed.\n${result.stdout || ""}${result.stderr || ""}`.trim(),
    );
  }
  return (result.stdout || "").trim();
}

function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => reject(new Error("process exit timed out")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function removeProfile(profileDir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
      return;
    } catch (error) {
      if (attempt === 4) {
        log(`Temporary profile cleanup skipped because Chrome still holds a file: ${profileDir}`);
        log(error instanceof Error ? error.message : String(error));
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replaceAll("'", "''");
}

function log(message) {
  console.error(`[mori-browser-smoke] ${message}`);
}

await main();
