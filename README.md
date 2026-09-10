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

The extension emits Browser observation messages, not Mori `TraceEvent` objects.
Mori converts these observations into Browser Context or Browser Trace through
its own `src/lib/trace/sources/browser` source.

## Permissions

`storage` is used for explicit opt-in and temporary debug state.

`tabs` is used to read the current tab/window snapshot and fetch the active tab
after `tabs.onActivated`. Chrome only exposes tab URL, pending URL, and title
when the extension has `tabs` or suitable host permissions.

`webNavigation` is used for `onCommitted`.

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
```

There is no build step yet. The current source is a plain Manifest V3 extension.

## Native Messaging Development

The extension connects with `chrome.runtime.connectNative()` only after browser
capture is explicitly enabled. Capture off means no Browser observations are
sent and the Native Messaging port is closed.

The native host is owned by `swarea/mori` and must be registered separately for
the unpacked extension id that Chrome assigns during development. Do not commit
that temporary id to source.

Typical local path for the Mori helper after building the relay worktree:

```text
C:\dev\mori-browser-native-host-dev\src-tauri\target\debug\mori-browser-native-host.exe
```

Register the host for Chrome from the Mori worktree after copying the actual
extension id from `chrome://extensions`:

```powershell
.\connectors\browser-native\install-native-host.ps1 -Browser chrome -HostPath "C:\dev\mori-browser-native-host-dev\src-tauri\target\debug\mori-browser-native-host.exe" -ExtensionId "<actual unpacked extension id>"
```

The popup debug section reports a compact Mori transport state such as
`connected`, `mori_unavailable`, or `disconnected`.

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
3. Confirm Mori Desktop from `C:\dev\mori-browser-native-host-dev` is running.
4. Activate a normal web tab.
5. Navigate that tab to a URL with query and fragment, for example
   `https://example.com/a?token=123#secret`.
6. Confirm the popup reports the Mori transport state.
7. Confirm the service worker console logs sanitized events and acknowledgements.
8. Turn capture off.
9. Switch or navigate tabs again and confirm event count no longer increases
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
