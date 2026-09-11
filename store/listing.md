# Store Listing Draft

## Name

Mori Browser Extension

## Short Description

Opt-in browser activity capture companion for Mori.

## Single Purpose

Send sanitized browser activity observations to Mori Desktop on this computer
after the user explicitly turns capture on.

## Long Description

Mori Browser Extension is a local companion for Mori Desktop. When you turn
browser activity capture on, the extension observes active tab changes,
committed page navigations, and the current normal window/tab snapshot. It sends
sanitized browser observations to Mori through Chrome Native Messaging so Mori
can build Browser Context and Browser Trace evidence on your computer.

The extension is explicit by design. Capture is off by default. When capture is
off, no browser observations are sent to Mori and the Native Messaging
connection is closed.

The extension minimizes browser data before it leaves Chrome. URLs keep origin
and path only. URL credentials, query strings, and fragments are removed. Page
titles are not captured by default. Browser internal pages and incognito tabs
are ignored.

Mori Browser Extension does not collect page contents, DOM, screenshots,
passwords, form input, cookies, account state, site session state, or imported
browser history. It does not inject content scripts, request host permissions,
serve ads, sell data, or transfer browser data to third-party advertising
systems.

Mori Desktop must be installed and running for the extension to deliver
observations. Without Mori Desktop, the extension can still open, but it will
report that Mori is unavailable.

## Category

Productivity

## Language

English

## Support URL

Owner to fill with the preferred Mori or SWAREA support URL before submission.

## Homepage URL

Owner to fill with the preferred Mori or SWAREA homepage URL before submission.

## Reviewer Test Instructions

1. Install or run Mori Desktop with the Mori browser native host available.
2. Install the extension.
3. Open the extension popup and confirm browser capture is off by default.
4. Turn browser capture on.
5. Open a normal non-incognito tab and navigate to `https://example.com/a?token=123#secret`.
6. Confirm the popup reports Mori transport status.
7. Confirm observations sent to Mori contain `https://example.com/a` and do not
   contain `token=123` or `#secret`.
8. Turn browser capture off.
9. Navigate again and confirm no new observations are sent.

If Mori Desktop is not running, the expected behavior is that the popup reports
Mori unavailable rather than sending data elsewhere.
