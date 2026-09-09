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
- Eventually transport observations to Mori.

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
debug snapshots and events are stored in `chrome.storage.session`, not in Mori's
app storage.

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

## Load Unpacked

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository directory.
5. Open the Mori Browser Extension popup and turn capture on.

## Manual Smoke Procedure

1. Confirm capture is off by default.
2. Turn capture on in the popup.
3. Click Refresh Snapshot and confirm the debug snapshot count updates.
4. Activate a normal web tab.
5. Navigate that tab to a URL with query and fragment, for example
   `https://example.com/a?token=123#secret`.
6. Confirm the service worker console logs sanitized events.
7. Confirm popup event count increases.
8. Turn capture off.
9. Switch or navigate tabs again and confirm event count no longer increases.

## Transport

Transport to the Mori app is deferred. The current shell keeps sanitized
extension-local debug output only. Future candidates are native messaging for
the desktop app or an explicit local connector file handoff. A local HTTP or
WebSocket server should only be added with a separate threat model.
