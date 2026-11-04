<div align="center">

<img src="icons/icon-128.png" alt="" width="88" height="88">

# Mori Browser Extension

**Browser-side companion for [Mori](https://github.com/hey-mori/mori).**

With your opt-in, it tells the Mori desktop app which page you are on, and
sends nothing anywhere else.

[Try it](#try-it) ·
[What it sends](#what-it-sends) ·
[Permissions](#permissions) ·
[Development](#development)

![status: pre-release](https://img.shields.io/badge/status-pre--release-6246f5)
[![license: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-1c1e22)](LICENSE)

</div>

Mori keeps a local record of your work. This extension adds the browser to it:
when you turn capture on, it reports which tab is active and which page it
navigated to, so Mori can place that activity on the same timeline as your
other sources. It sends only the origin and path of a URL, never reads page
content, and talks only to the Mori app on the same computer, through Chromium
Native Messaging.

> **Status.** Pre-release, for developers. The extension is not in the Chrome
> Web Store, and Mori itself has no release yet, so trying it means building
> Mori from source and loading this extension unpacked. The native host that
> connects them is Windows-only today. Chrome and Edge are the browsers the
> host installer supports.

## How it fits together

```
Chromium tab events ──▶ this extension ──▶ Native Messaging host ──▶ Mori desktop app
     (opt-in only)       (filters URLs)     (mori-browser-native-host)   (local database)
```

The extension observes and filters. Mori owns everything after that: what an
observation means, how it appears in the record, and how long it is kept. The
native host, `com.swarea.mori.browser`, ships with Mori.

## Try it

You need Windows, Chrome or Edge, and a Mori build from source (see
[Mori's build instructions](https://github.com/hey-mori/mori#build-from-source)).

1. **Build and start Mori**, and build its native host helper from the Mori
   checkout:

   ```powershell
   cargo build --manifest-path src-tauri/Cargo.toml --bin mori-browser-native-host
   ```

2. **Load this extension unpacked.** Open `chrome://extensions` (or
   `edge://extensions`), turn on Developer mode, choose *Load unpacked*, and
   select this repository's directory. The manifest's `key` gives it the same
   id everywhere: `nmkjbmmnefgglmkddfokahclckjkldek`.

3. **Register the native host for that id**, from the Mori checkout:

   ```powershell
   .\connectors\browser-native\install-native-host.ps1 -Browser chrome `
     -HostPath "$PWD\src-tauri\target\debug\mori-browser-native-host.exe" `
     -ExtensionId nmkjbmmnefgglmkddfokahclckjkldek
   ```

   Use `-Browser edge` for Edge. A Mori build whose installer registers this id
   does this step for you.

4. **Open the extension's popup and turn capture on.** The popup shows whether
   Mori received recent activity, is not running, or could not be reached.
   Turning capture off closes the connection and stops all observation.

## What it sends

Only after you turn capture on, and only these events:

| Event | Source |
| --- | --- |
| The active tab changed | `chrome.tabs.onActivated` |
| A page finished navigating in the main frame | `chrome.webNavigation.onCommitted` |
| A single-page app changed its route | `chrome.webNavigation.onHistoryStateUpdated` |
| A snapshot of open windows and tabs | `chrome.windows.getAll` |

Each URL is reduced to its origin and path: query strings, fragments and
credentials are removed, and page titles are not sent. Internal pages
(`chrome://`, `edge://`, `about:`, `devtools://`, extension pages) are ignored,
and the extension is disabled in incognito windows.

It never reads page content or the DOM, form input or password fields,
cookies, browser history, or screenshots. There is no network request: the only
destination is Mori, on the same computer. If Mori is not running, events are
dropped, not queued.

The on/off choice is kept in `chrome.storage.local` so it survives a service
worker restart. Recent diagnostic state stays in `chrome.storage.session` and
disappears when the browser closes.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remember your opt-in and keep short-lived diagnostics. |
| `tabs` | Read the active tab's URL, which Chrome exposes only with this permission. |
| `webNavigation` | Learn when a page or route finishes changing. |
| `nativeMessaging` | Talk to the Mori native host on this computer. |

No host permissions, content scripts, `history`, `cookies`, `webRequest`,
`scripting`, `downloads`, `bookmarks` or clipboard access are requested.

## Development

```bash
npm ci
npm run check   # unit tests, manifest validation, package build and inspection
```

`npm test`, `npm run validate`, `npm run package:chrome` and
`npm run inspect:chrome-package` run the steps on their own. The extension is
plain Manifest V3 JavaScript with no build step.

[docs/development.md](docs/development.md) covers the observation format, the
Native Messaging transport, the automated Chrome smoke test, and the manual
check to run before a change that touches capture.
[docs/chrome-web-store-readiness.md](docs/chrome-web-store-readiness.md) and
[`store/`](store) hold the prepared Chrome Web Store listing. Nothing has been
submitted to the Store.

## Contributing

Run `scripts/setup-git-hooks.sh` once per clone, then `npm run check` before
opening a pull request. Commits follow the
[Mori commit format](https://github.com/hey-mori/.github/blob/main/docs/commit-format.md),
which the `commit-msg` hook and CI both check. Contributors from outside the
organization sign off each commit (`git commit -s`); the organization's
[contributing guide](https://github.com/hey-mori/.github/blob/main/CONTRIBUTING.md)
explains why and covers the rest.

## Security

Report a vulnerability privately with this repository's
[report form](https://github.com/hey-mori/mori-browser-extension/security/advisories/new),
never in an issue. The organization's
[security policy](https://github.com/hey-mori/.github/blob/main/SECURITY.md)
covers what to include and what happens next.

## License

The source code in this repository is licensed under the [Mozilla Public License 2.0](LICENSE)
(`MPL-2.0`). Copyright 2026 Isaac Lee.

- Third-party dependencies keep their own licences.
- The licence grants no rights to the Mori names or logos as trademarks.
- Contributions are accepted under the same licence.

Chrome and Chromium are trademarks of Google LLC. Microsoft Edge is a trademark
of Microsoft Corporation. This extension is not affiliated with or endorsed by
either.
