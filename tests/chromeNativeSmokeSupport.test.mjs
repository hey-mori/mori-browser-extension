import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import {
  assertRequiredSmokeResult,
  buildInstallNativeHostCommand,
  buildNativeHostAllowedOrigin,
  chromeNativeHostRegistryPath,
  createSmokeResult,
  defaultMoriWorktree,
  defaultNativeHostPath,
  isChromiumExtensionId,
  nativeHostManifestPath,
  parseChromeVersion,
  parseSmokeArgs,
  readDevToolsActivePort,
  readDevToolsListeningLine,
} from "../scripts/lib/chromeNativeSmokeSupport.mjs";

describe("chrome native smoke support", () => {
  it("parses explicit command options without hard-coding extension identity", () => {
    const options = parseSmokeArgs([
      "--chrome-path",
      "C:/Chrome/chrome.exe",
      "--mori-worktree",
      "C:/dev/mori-browser-native-host-dev",
      "--native-host-path",
      "C:/dev/mori-browser-native-host-dev/src-tauri/target/debug/mori-browser-native-host.exe",
      "--keep-profile",
      "--registration-mode",
      "existing",
      "--expected-manifest-path",
      "C:/Users/Isaac/AppData/Local/Mori/NativeMessagingHosts/com.swarea.mori.browser.json",
    ]);

    assert.equal(options.chromePath, "C:/Chrome/chrome.exe");
    assert.equal(options.moriWorktree, "C:/dev/mori-browser-native-host-dev");
    assert.equal(
      options.nativeHostPath,
      "C:/dev/mori-browser-native-host-dev/src-tauri/target/debug/mori-browser-native-host.exe",
    );
    assert.equal(options.keepProfile, true);
    assert.equal(options.registrationMode, "existing");
    assert.equal(
      options.expectedManifestPath,
      "C:/Users/Isaac/AppData/Local/Mori/NativeMessagingHosts/com.swarea.mori.browser.json",
    );
  });

  it("rejects unknown native host registration modes", () => {
    assert.throws(() => parseSmokeArgs(["--registration-mode", "magic"]), /temporary or existing/);
  });

  it("derives local Mori and native host paths from the extension checkout", () => {
    const extensionRoot = path.resolve("C:/dev/mori-browser-extension");
    const moriWorktree = defaultMoriWorktree(extensionRoot);

    assert.equal(moriWorktree, path.resolve("C:/dev/mori-browser-native-host-dev"));
    assert.equal(
      defaultNativeHostPath(moriWorktree),
      path.resolve(
        "C:/dev/mori-browser-native-host-dev/src-tauri/target/debug/mori-browser-native-host.exe",
      ),
    );
  });

  it("builds native host registration from the runtime extension id", () => {
    const extensionId = "abcdefghijklmnopabcdefghijklmnop";
    const manifestPath = nativeHostManifestPath("C:/Temp/mori-browser-smoke-1");
    const command = buildInstallNativeHostCommand({
      moriWorktree: "C:/dev/mori-browser-native-host-dev",
      nativeHostPath:
        "C:/dev/mori-browser-native-host-dev/src-tauri/target/debug/mori-browser-native-host.exe",
      extensionId,
      manifestPath,
    });

    assert.equal(command.command, "powershell");
    assert.ok(command.args.includes("-ExtensionId"));
    assert.ok(command.args.includes(extensionId));
    assert.ok(command.args.includes("-ManifestPath"));
    assert.ok(command.args.includes(manifestPath));
    assert.equal(
      buildNativeHostAllowedOrigin(extensionId),
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
    );
  });

  it("validates Chromium extension ids and registry paths", () => {
    assert.equal(isChromiumExtensionId("abcdefghijklmnopabcdefghijklmnop"), true);
    assert.equal(isChromiumExtensionId("ebkcmfnikempiiafmehofoalnknfoblg"), true);
    assert.equal(isChromiumExtensionId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), false);
    assert.equal(
      chromeNativeHostRegistryPath("chrome"),
      "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.swarea.mori.browser",
    );
  });

  it("parses Chrome diagnostic values", () => {
    assert.equal(parseChromeVersion("Google Chrome 152.0.7977.83\r\n"), "Google Chrome 152.0.7977.83");
    assert.deepEqual(readDevToolsActivePort("9222\n/devtools/browser/abc\n"), {
      port: 9222,
      browserWebSocketPath: "/devtools/browser/abc",
      browserWebSocketUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    assert.deepEqual(
      readDevToolsListeningLine(
        "DevTools listening on ws://127.0.0.1:59412/devtools/browser/8acb",
      ),
      {
        port: 59412,
        browserWebSocketPath: "/devtools/browser/8acb",
        browserWebSocketUrl: "ws://127.0.0.1:59412/devtools/browser/8acb",
      },
    );
  });

  it("fails only required smoke result checks that were not skipped", () => {
    const result = createSmokeResult();
    for (const key of [
      "extensionLoaded",
      "hostRegistered",
      "contextSnapshot",
      "navigationCommitted",
      "tabActivated",
      "popupOptIn",
      "captureOffBlocked",
      "hostMissing",
      "urlSanitized",
    ]) {
      result[key] = true;
    }
    result.skipped.push("moriUnavailable");

    assert.doesNotThrow(() => assertRequiredSmokeResult(result));
    result.hostMissing = false;
    assert.throws(() => assertRequiredSmokeResult(result), /hostMissing/);
  });
});
