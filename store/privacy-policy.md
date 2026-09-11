# Mori Browser Extension Privacy Policy

Last updated: 2026-09-11

Mori Browser Extension is an opt-in local companion for Mori Desktop. It helps
Mori understand browser activity by sending sanitized browser observations to
Mori Desktop on your computer through Chrome Native Messaging.

## What the Extension Collects

After you explicitly turn browser activity capture on, the extension may collect:

- active tab changes;
- committed main-frame navigations;
- current normal window and tab metadata;
- sanitized URL origin and path.

## What the Extension Does Not Collect

The extension does not collect:

- page contents or DOM;
- screenshots;
- passwords or form input;
- cookies;
- account or site session state;
- imported browser history;
- incognito tabs or windows;
- URL credentials, query strings, or fragments;
- page titles by default.

## How Data Is Used

Browser observations are used only to provide Mori's browser context and browser
trace features. Mori Desktop receives the observations locally and decides how
to store, interpret, or discard them according to Mori's own local-first memory
model.

## Data Transfer

The extension sends observations to the Mori native host
`com.swarea.mori.browser` on the same computer. The extension does not sell
browser data, use browser data for advertising, or transfer browser data to
third-party advertising platforms.

## User Control

Browser activity capture is off by default. You can turn capture on or off in
the extension popup. When capture is off, the extension does not send browser
observations to Mori and closes the Native Messaging connection.

Chrome incognito mode is not allowed by the extension manifest, and incognito
tabs or windows are also ignored defensively.

## Limited Use

Use and transfer of data from the extension is limited to the extension's
single purpose: sending sanitized browser activity observations to Mori Desktop
on this computer after explicit user opt-in.

## Contact

Owner to fill with the preferred Mori or SWAREA support contact before
publishing this policy.
