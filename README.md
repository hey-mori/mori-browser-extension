# Mori Browser Extension

Browser-side runtime companion for Mori.

This repository owns the Chromium/WebExtension runtime layer. Mori itself owns
Browser Context, Browser Trace, Trace projection, and semantic interpretation.

Extracted from the initial Browser runtime prototype developed inside
`swarea/mori`.

## Responsibilities

- Observe browser runtime state.
- Emit versioned browser observation messages.
- Keep browser capture explicitly opt-in.
- Request minimal browser permissions.
- Apply browser-side privacy filtering before observations leave the extension.
- Transport sanitized observations to Mori through Chromium Native Messaging.

## Non-Responsibilities

- Flow interpretation.
- Episode generation.
- Memory generation.
- Account or identity inference.
- Site session inference.
- Browser workspace, Park, Resume, Handoff, or Sync.
- DOM capture, content scripts, cookies, or browser history import.
- Mori semantic analysis.

## Current Scope

The extension can observe, only after explicit opt-in:

- active tab changes through `chrome.tabs.onActivated`;
- committed main-frame navigations through `chrome.webNavigation.onCommitted`;
- same-document main-frame route changes through
  `chrome.webNavigation.onHistoryStateUpdated`;
- a current context snapshot through `chrome.windows.getAll({ populate: true })`.

The extension stores `captureEnabled` in `chrome.storage.local` so the Manifest
V3 service worker can restart without losing the user's opt-in choice. Sanitized
debug snapshots, events, and Native Messaging status are stored in
`chrome.storage.session`, not in Mori's app storage.

## Observation Contract

The wire boundary to Mori is a small v1 envelope:

```json
{
  "version": 1,
  "source": "browser",
  "kind": "tab_activated",
  "observedAt": "2026-09-09T00:01:00.000Z",
  "payload": {}
}
```

Current fixtures:

- `fixtures/context-snapshot.v1.json`
- `fixtures/tab-activated.v1.json`
- `fixtures/navigation-committed.v1.json`
- `fixtures/history-state-updated.v1.json`

The extension emits Browser observation messages, not Mori `TraceEvent` objects.
Mori converts these observations into Browser Context or Browser Trace through
its own `src/lib/trace/sources/browser` source.

## Permissions

`storage` is used for explicit opt-in and temporary debug state.

`tabs` is used to read the current tab/window snapshot and fetch the active tab
after `tabs.onActivated`. Chrome only exposes tab URL, pending URL, and title
when the extension has `tabs` or suitable host permissions.

`webNavigation` is used for `onCommitted` and `onHistoryStateUpdated`.

`nativeMessaging` is used to connect to the Mori native host:

```text
com.swarea.mori.browser
```

No host permissions are requested in this shell. No `history`, `cookies`,
`webRequest`, `scripting`, `downloads`, `bookmarks`, clipboard, or content
script permissions are requested.

## Privacy

The extension does not collect:

- page content or DOM;
- password fields or form input;
- cookies;
- account or site-session state;
- browser history;
- screenshots.

The default URL policy keeps origin plus path and drops credentials, query, and
fragment. Titles are not captured by default. Browser internal and extension
URLs such as `chrome://`, `chrome-extension://`, `edge://`, `about:`, and
`devtools://` are ignored. Incognito is disabled in the manifest and incognito
windows/tabs are also dropped defensively.

## Development

Run the local checks:

```bash
npm test
npm run validate
npm run package:chrome
npm run inspect:chrome-package
npm run check
npm run smoke:chrome-native
```

The current source is a plain Manifest V3 extension. The Chrome Web Store
package step stages the runtime allowlist and writes a deterministic ZIP under
`dist/chrome`.

Chrome Web Store readiness materials live in:

- `docs/chrome-web-store-readiness.md`
- `store/listing.md`
- `store/privacy-policy.md`
- `store/privacy-practices.md`
- `store/assets`

These files prepare an owner handoff only. They do not imply that a Store item
has been created, uploaded, submitted, or published.

## Native Messaging Development

The extension connects with `chrome.runtime.connectNative()` only after browser
capture is explicitly enabled. Capture off means no Browser observations are
sent and the Native Messaging port is closed.

The native host is owned by `swarea/mori`. Development smoke tooling loads this
unpacked extension in an isolated Chrome profile, reads the extension id that
Chrome assigns at runtime, and registers the native host for that id. Do not
commit a temporary unpacked id to source.

Typical local path for the Mori helper after building the relay worktree:

```text
C:\dev\mori\src-tauri\target\debug\mori-browser-native-host.exe
```

Manual registration is still possible from the Mori worktree after copying the
actual extension id from `chrome://extensions`:

```powershell
.\connectors\browser-native\install-native-host.ps1 -Browser chrome -HostPath "C:\dev\mori\src-tauri\target\debug\mori-browser-native-host.exe" -ExtensionId "<actual unpacked extension id>"
```

The popup shows capture off, confirmed recent delivery, Mori not running, or
an installation/delivery problem. Diagnostics are folded away. Opening the
popup does not start capture; manual snapshot refresh requires capture on.
Mori Desktop keeps a last-observed current snapshot in memory and persists
sanitized activation, navigation, and same-document route evidence in its
existing local database.

## Chrome Native Smoke

The canonical development smoke is:

```powershell
npm run smoke:chrome-native -- --mori-worktree "C:\dev\mori"
```

To smoke the staged Chrome Web Store runtime instead of the repository root:

```powershell
npm run package:chrome
npm run smoke:chrome-native -- --extension-root "<extension-repo>\dist\chrome\mori-browser-extension-0.1.0" --mori-worktree "C:\dev\mori"
```

Prerequisites:

- Google Chrome is installed, or `--chrome-path` points to `chrome.exe`.
- Mori Desktop is already running from the Mori browser relay worktree.
- The native host helper has been built at
  `C:\dev\mori\src-tauri\target\debug\mori-browser-native-host.exe`,
  or `--native-host-path` points to another helper executable.

The smoke harness:

1. starts Google Chrome with a temporary profile;
2. enables development-only CDP extension debugging;
3. loads this unpacked extension with `Extensions.loadUnpacked`;
4. registers `com.swarea.mori.browser` for the returned extension id by reusing
   Mori's Native Messaging installer script;
5. toggles capture through the extension popup page;
6. verifies `context_snapshot`, `navigation_committed`, `tab_activated`, and,
   when requested, `history_state_updated`, plus capture-off blocking, URL
   sanitization, `mori_unavailable`, and host-missing failure handling;
7. restores the previous Chrome Native Messaging registration and removes the
   temporary Chrome profile.

CDP is a smoke-test driver only. The extension runtime does not import or call
CDP, and production Mori does not depend on CDP.

The script prints a machine-readable JSON summary and exits non-zero when a
required check fails. The `mori_unavailable` check uses a temporary relay name
that no Mori Desktop instance is expected to serve, so the same local IPC
failure semantics can be tested without stopping the developer's running Mori.

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository directory.
5. Copy the assigned extension id.
6. Register the Mori native host with that id.
7. Open the Mori Browser Extension popup and turn capture on.

## Manual Smoke Procedure

1. Confirm capture is off by default.
2. Turn capture on in the popup.
3. Confirm Mori Desktop from `C:\dev\mori` is running.
4. Activate a normal web tab.
5. Navigate that tab to a URL with query and fragment, for example
   `https://example.com/a?token=123#secret`.
6. On an SPA test page, change the route with `history.pushState` and confirm
   Mori records a distinct same-document route event with query and fragment
   removed.
7. Confirm the popup reports the Mori transport state.
8. Confirm Mori's Connections settings show recent receipt. Console diagnostics
   contain only source/kind; payloads and URLs are not logged.
9. Turn capture off.
10. Switch or navigate tabs again and confirm event count no longer increases
   and no new observations are sent.

## Transport

Native Messaging is the extension-to-host transport. The extension sends
Browser observation envelopes, not Mori `TraceEvent` objects. The native host
relays those envelopes to running Mori Desktop, where Mori's Browser ingress
accepts or rejects them.

The client uses a small `runtime.Port` created by `connectNative()`. The port is
opened lazily when capture is on, closed when capture is turned off, and
recreated on the next observation if the Manifest V3 service worker restarts or
the native host disconnects. There is no offline queue, retry loop, heartbeat,
local HTTP server, WebSocket server, or file-per-event spool.

With a compatible Mori live-source build, a successful trace acknowledgement
may request a fresh context snapshot through the additive `contextRequired`
hint. The next snapshot refresh is coalesced and guarded by capture consent.
This restores Mori's memory-only context after restart without a heartbeat.
Outstanding sends are bounded at 32; a stalled helper times out after 10 seconds
and reconnects on the next observation. Events sent while Mori is unavailable
are not queued for replay.

Chrome Web Store work is intentionally deferred for the live-source milestone.
Existing packaging, icons, listing and privacy assets remain prepared locally.
