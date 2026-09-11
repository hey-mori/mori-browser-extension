# Chrome Web Store Privacy Practices Draft

Use this as the owner-facing source for the Developer Dashboard privacy tab.

## Single Purpose

The extension sends sanitized browser activity observations to Mori Desktop on
this computer after explicit opt-in.

## User Data Disclosure

The extension collects browsing activity only when browser capture is explicitly
enabled by the user. The collected data is limited to active tab changes,
committed main-frame navigations, current normal window/tab metadata, and
sanitized URL origin plus path.

The extension does not collect web page contents, DOM, screenshots, passwords,
form input, cookies, account state, site session state, imported browser
history, incognito tabs/windows, URL credentials, query strings, fragments, or
page titles by default.

## Limited Use Certification

The extension complies with Limited Use requirements:

- browser activity data is used only for Mori's browser context and browser
  trace features;
- browser activity data is not sold;
- browser activity data is not used for advertising;
- browser activity data is not transferred to third-party advertising systems;
- human access to browser activity data is not part of the extension's
  operation.

## Remote Code

The extension does not use remotely hosted executable code.

## Permissions Justification

- `storage`: stores explicit opt-in state and temporary debug state.
- `tabs`: reads active tab and normal window metadata needed for the
  user-facing capture feature.
- `webNavigation`: observes committed main-frame navigations needed for the
  user-facing capture feature.
- `nativeMessaging`: sends observations to Mori Desktop through
  `com.swarea.mori.browser`.

## Privacy Policy URL

Owner must publish `store/privacy-policy.md` at a stable public HTTPS URL before
submission and paste that URL into the Dashboard.
