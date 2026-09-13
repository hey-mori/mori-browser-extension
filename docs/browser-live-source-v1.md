# Browser Live Source v1

Date: 2026-09-13. Companion: Mori issue
[#122](https://github.com/swarea/mori/issues/122); extension issue
[#8](https://github.com/swarea/mori-browser-extension/issues/8).

## Contract

The three v1 observation kinds and opt-in ownership are unchanged. Mori now
keeps Context in application memory and commits tab/navigation evidence to its
existing SQLite database before returning a successful trace ACK.

An optional `contextRequired: true` on a successful ACK requests one coalesced
snapshot. It restores missing or stale Context after Mori restarts without a
collector timer, new event kind, plugin framework or offline queue.

Outstanding sends cap at 32. A ten-second timeout closes the FIFO port and
rejects all waits; old-port callbacks cannot consume new-port acknowledgements.
Collection checks consent generation after asynchronous lookup and before send.
Manual diagnostic capture is disabled while OFF. Already transmitted evidence
cannot be revoked by turning OFF, and existing Mori history is not deleted.

## User Surface

The popup projects consent and recent delivery into plain status text. Missing
host, stopped Mori and persistence failure are distinct. Detailed counts and
manual refresh are collapsed under Diagnostics. The labeled checkbox remains
keyboard operable; privacy disclosure is visible without opening Diagnostics.
Store assets and privacy wording follow this UI, but Store work is deferred.

## Verification

`npm run check`: 34 tests passed, manifest validation passed, deterministic ZIP
creation and explicit package inspection passed. No permission expansion.

The companion Mori `scripts/browser-live-smoke.mjs` imports this repository's
Chrome test helpers and uses real Chrome with the staged package. Two full
isolated runs each stored 99 deliveries over 60 navigations, with no failure.
A final run through the sidecar prepared for NSIS passed 15 scenarios including
keyboard opt-in, 20 navigations, 33 deliveries and the minimum desktop viewport.

Validated: Mori-first, Chrome-first recovery, Mori crash/restart durability,
Chrome restart with persisted opt-in, MV3 restart, context recovery, actual
pending window lookup released after OFF, ten later OFF navigations, and
missing native host. Stored synthetic URLs had no query, fragment or title.
The helper now discards only a previous test profile's stale DevTools endpoint
before restarting Chrome, and gives Chrome time to exit before forced cleanup.

Desktop uses a test-only instrumented release for UI/read-API inspection; the
native host is the actual release/packaged helper. Previous host registration
is restored. This is not a Store install, multi-day reliability claim, or
Windows reboot test. Detailed measurements and scope are in Mori's
`docs/design/browser-live-source-v1-report.md`.
