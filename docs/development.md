# Developing the extension

How the extension talks to Mori, and how to check a change end to end. For
what the extension does and how to try it, see the [README](../README.md).

## Scope

This repository owns the Chromium runtime layer:

- observe browser runtime state, only after explicit opt-in;
- request the minimum permissions;
- filter URLs before anything leaves the extension;
- emit versioned observation messages;
- deliver them to Mori through Chromium Native Messaging.

Mori owns everything after delivery: Browser Context, Browser Trace, how an
observation is projected into the record, and what it means. The extension
does not interpret activity, infer accounts or site sessions, capture the DOM,
use content scripts, read cookies, or import browser history.

## Observation format

Every message to Mori is a small v1 envelope:

```json
{
  "version": 1,
  "source": "browser",
  "kind": "tab_activated",
  "observedAt": "2026-09-09T00:01:00.000Z",
  "payload": {}
}
```

The kinds are `context_snapshot`, `tab_activated`, `navigation_committed` and
`history_state_updated`. Fixtures for each are in [`fixtures/`](../fixtures).
The extension emits these observations, not Mori `TraceEvent` objects; Mori
converts them through its own `src/lib/trace/sources/browser` source.
[browser-live-source-v1.md](browser-live-source-v1.md) records the contract
for the live source.

## Transport

Native Messaging is the only transport. The extension opens a
`runtime.Port` with `chrome.runtime.connectNative()` lazily, only while capture
is on, and closes it when capture is turned off. It is recreated on the next
observation if the Manifest V3 service worker restarts or the host disconnects.
There is no offline queue, retry loop, heartbeat, local HTTP or WebSocket
server, or file spool.

The native host, `com.swarea.mori.browser`, lives in `hey-mori/mori`. It
relays each envelope to the running Mori desktop app, whose browser ingress
accepts or rejects it.

- A successful acknowledgement may carry a `contextRequired` hint, which asks
  for a fresh context snapshot. The next refresh is coalesced and still
  guarded by capture consent. This restores Mori's memory-only context after
  Mori restarts, without a heartbeat.
- At most 32 sends are outstanding. A stalled helper times out after 10
  seconds and reconnects on the next observation.
- Events sent while Mori is unavailable are dropped, not replayed.

## Native host for development

Build the helper in a Mori checkout:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --bin mori-browser-native-host
```

Load this repository unpacked, copy the extension id Chrome assigns, and
register the host for it from the Mori checkout:

```powershell
.\connectors\browser-native\install-native-host.ps1 -Browser chrome `
  -HostPath "<mori checkout>\src-tauri\target\debug\mori-browser-native-host.exe" `
  -ExtensionId "<actual unpacked extension id>"
```

Never commit a temporary unpacked id to either repository.

## Automated Chrome smoke

The canonical end-to-end check, on Windows:

```powershell
npm run smoke:chrome-native -- --mori-worktree "<mori checkout>"
```

To smoke the staged Chrome Web Store package instead of the repository root:

```powershell
npm run package:chrome
npm run smoke:chrome-native -- --extension-root "dist\chrome\mori-browser-extension-0.1.0" --mori-worktree "<mori checkout>"
```

Prerequisites:

- Google Chrome is installed, or `--chrome-path` points to `chrome.exe`.
- Mori is already running from that checkout.
- The native host helper is built at
  `<mori checkout>\src-tauri\target\debug\mori-browser-native-host.exe`, or
  `--native-host-path` points to another build. `MORI_WORKTREE` can stand in
  for `--mori-worktree`.

The harness:

1. starts Chrome with a temporary profile;
2. enables development-only CDP extension debugging;
3. loads this unpacked extension with `Extensions.loadUnpacked`;
4. registers `com.swarea.mori.browser` for the returned extension id, using
   Mori's Native Messaging installer script;
5. toggles capture through the extension popup page;
6. verifies `context_snapshot`, `navigation_committed`, `tab_activated` and,
   when requested, `history_state_updated`, plus capture-off blocking, URL
   sanitization, `mori_unavailable`, and host-missing failure handling;
7. restores the previous Native Messaging registration and removes the
   temporary profile.

CDP drives the test only. The extension runtime never imports or calls CDP,
and Mori does not depend on it. The script prints a machine-readable JSON
summary and exits non-zero when a required check fails. The
`mori_unavailable` check uses a relay name no running Mori serves, so it can
run without stopping your Mori instance.

## Manual check

Run this before a change that touches capture or URL filtering:

1. Confirm capture is off by default.
2. Turn capture on in the popup.
3. Confirm Mori is running.
4. Activate a normal web tab.
5. Navigate it to a URL with a query and a fragment, such as
   `https://example.com/a?token=123#secret`.
6. On a single-page app, change the route with `history.pushState` and confirm
   Mori records a distinct route event with the query and fragment removed.
7. Confirm the popup reports the transport state, and that Mori's Connections
   settings show a recent receipt. Console diagnostics contain only source and
   kind, never payloads or URLs.
8. Turn capture off, switch or navigate tabs again, and confirm that the event
   count stops increasing and nothing more is sent.
