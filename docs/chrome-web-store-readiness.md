# Chrome Web Store Readiness

This document records the engineering handoff for preparing the Mori Browser
Extension for Chrome Web Store identity. It does not authorize upload,
submission, publication, or production signing.

## Baseline

- Extension repository baseline: `02e63c06f4a1d0a0cbc79a44eaaa4f429d5d77aa`
- Mori repository baseline: `0ef2539e36195745a6e5351b394021341b3ce55c`
- Browser observation envelope: v1, unchanged

## Single Purpose

Mori Browser Extension is an opt-in local companion for Mori Desktop. Its
single purpose is to send sanitized browser activity observations to a running
Mori Desktop instance on the same computer so Mori can build Browser Context and
Browser Trace evidence.

The extension is not a browser history importer, account tracker, advertising
tool, analytics product, sync service, or standalone memory product.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Stores explicit capture opt-in in `chrome.storage.local` and temporary debug state in `chrome.storage.session`. |
| `tabs` | Reads the current active tab and normal window snapshot after explicit opt-in. Chrome requires `tabs` or host permissions for tab URL metadata. |
| `webNavigation` | Observes committed main-frame navigations after explicit opt-in. |
| `nativeMessaging` | Sends sanitized observations to the Mori native host `com.swarea.mori.browser`. |

The manifest intentionally does not request host permissions, content scripts,
`history`, `cookies`, `webRequest`, `scripting`, `downloads`, `bookmarks`, or
clipboard permissions.

## User Data

Collected after explicit opt-in:

- active tab changes;
- committed main-frame navigations;
- current normal window and tab metadata;
- sanitized URL origin and path.

Not collected:

- page contents or DOM;
- screenshots;
- passwords or form input;
- cookies;
- account or site session state;
- browser history import;
- incognito tabs or windows;
- URL credentials, query strings, or fragments;
- page titles by default.

## Prominent Disclosure

The popup includes an explicit disclosure next to the capture toggle. It states
that capture is opt-in, local to this computer, and limited to sanitized browser
activity. The popup also lists what is and is not collected.

## Store Package

Generate the deterministic submission package:

```powershell
npm run package:chrome
npm run inspect:chrome-package
```

Expected outputs:

- `dist/chrome/mori-browser-extension-0.1.0/`
- `dist/chrome/mori-browser-extension-0.1.0.zip`

The ZIP is generated from an explicit allowlist and excludes tests, fixtures,
documentation, development scripts, logs, local paths, and generated output.

## Package Inspection

The package inspector checks:

- ZIP entries exactly match the runtime allowlist;
- Manifest V3 is used;
- expected icons exist and are wired into `manifest.icons` and `action.default_icon`;
- no host permissions or content scripts are present;
- forbidden permissions stay absent;
- no `<all_urls>` appears;
- packaged text does not contain remote scripts, dynamic remote imports,
  `eval`, `new Function`, hard-coded extension ids, local development paths, or
  AI attribution footers.

## Store Assets

Prepared assets:

- `store/assets/store-icon-128.png`
- `store/assets/small-promo-440x280.png`
- `store/assets/screenshots/popup-default-1280x800.png`

The icon assets are derived from Mori's generated app icon in `swarea/mori`.
The screenshot is a Chrome-rendered capture of the extension popup default
state with no private browser data.
It was refreshed on 2026-09-13 for the daily-use popup: capture off, connection
status visible, and diagnostics collapsed. Store publication remains deferred.

## Privacy Policy Hosting

`store/privacy-policy.md` is the source copy. Before any Chrome Web Store
submission, the owner must publish it at a stable public HTTPS URL controlled by
SWAREA or Mori and paste that URL into the Developer Dashboard privacy section.

Do not use a local file, private repository URL, temporary gist, or draft PR URL
as the privacy policy URL.

## Chrome Web Store Dashboard Handoff

Owner-only steps:

1. Confirm or create the Chrome Web Store developer account.
2. Create a new item only when ready to reserve production Store identity.
3. Upload `dist/chrome/mori-browser-extension-0.1.0.zip`.
4. Fill Store Listing from `store/listing.md`.
5. Fill Privacy fields from `store/privacy-practices.md`.
6. Add the public privacy policy URL.
7. Upload prepared assets from `store/assets`.
8. Select initial visibility deliberately. Private or unlisted test versions
   still go through Chrome review.
9. Do not submit for review until the Mori production native host registration
   and Store extension id path are ready.

## Review Risk

Primary review risks:

- `tabs` and `webNavigation` are sensitive because they expose browsing
  activity. The extension must keep the single purpose, prominent disclosure,
  and URL minimization intact.
- `nativeMessaging` requires reviewers to understand the local Mori Desktop
  dependency. Store test instructions must explain that Mori Desktop is required
  for the happy path.
- Any future title capture, DOM/content script capture, host permission, remote
  code, analytics, sync, or cloud transfer would require a new policy review and
  updated disclosure.

## Production Identity Path

This milestone does not create or upload a production Chrome Web Store item.
After the owner creates an item, Chrome assigns a production extension id.
Mori Desktop packaging must then register the native host allowed origin for
that production id. Until that happens, the development smoke harness should
continue using temporary registration for unpacked/staged validation.

## Official References

- Chrome Web Store Developer Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- User Data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Privacy Dashboard: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Publish: https://developer.chrome.com/docs/webstore/publish
- Distribution: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- Review Process: https://developer.chrome.com/docs/webstore/review-process
- Quality Guidelines FAQ: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
- Images and Screenshots: https://developer.chrome.com/docs/webstore/images
- Store Listing: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
