# Browser Live Source v1

Date: 2026-09-14. Companion: Mori issues
[#122](https://github.com/swarea/mori/issues/122) and
[#128](https://github.com/swarea/mori/issues/128); extension issues
[#8](https://github.com/swarea/mori-browser-extension/issues/8) and
[#10](https://github.com/swarea/mori-browser-extension/issues/10).

## Contract

The v1 envelope and opt-in ownership are unchanged. The closed kind set now
contains `context_snapshot`, `tab_activated`, `navigation_committed`, and
`history_state_updated`. The latter records main-frame History API route
changes as evidence distinct from a committed document navigation. Mori keeps
Context in application memory and commits activity evidence to its existing
SQLite database before returning a successful trace ACK.

`history_state_updated` uses the same origin-plus-path privacy policy and
capture-generation guard as other activity. It does not mutate Context, listen
for fragment-only changes, import browser history, or infer task meaning.

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

`npm run check` passed 39 tests plus manifest validation, deterministic ZIP
creation, and package inspection. No permission expansion is required; both
document commits and History API updates use `webNavigation`.

A 2026-09-14 isolated Chrome 152 run against the companion Mori receiver passed
all scenarios with no failure. One `pushState` and one `replaceState` each
produced exactly one durable `history_state_updated` row. A fragment-only update
produced none, while two query-only updates produced two rows with the same
sanitized `/search` URL. The mixed history held 111 rows across three pages and
survived Mori restart. The run also covered a pending History API lookup released
after capture was turned off, 60 full navigations, MV3 restart, Chrome restart,
and missing-host reporting. This is an isolated development E2E result, not a
Store installation or long-duration reliability claim.

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
