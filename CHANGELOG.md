# Changelog

## 0.2.8

- `get()` with offline persistence throws when the server can't be reached
  and the document is not cached, instead of returning null.
- Uses rivium-sync-android 0.2.8 and RiviumSync (iOS) 0.2.6, installed
  automatically.

## 0.2.7

- Android release builds (R8 / ProGuard) work without rules in your app.
- Uses rivium-sync-android 0.2.7, installed automatically.

## 0.2.6

- Realtime is always encrypted; the SDK never connects unencrypted.
- iOS: the `apiUrl`, `mqttHost`, `mqttPort` and `mqttUseTls` options are no
  longer read; Rivium's endpoints are always used.
- Uses rivium-sync-android 0.2.6 and RiviumSync (iOS) 0.2.5, installed
  automatically.

## 0.2.5

- Realtime connects where the Sync API tells it (host, port and whether the
  connection is encrypted), so your project can move to encrypted realtime
  (`mqtts`, port 8885) without an app update. It never falls back from an
  encrypted connection to a plain one.
- iOS: the package no longer forces an unencrypted connection; `mqttUseTls`
  is passed to the native SDK only when your app sets it.
- Uses rivium-sync-android 0.2.5 and RiviumSync (iOS) 0.2.4, installed
  automatically.
- Added `THIRD_PARTY_NOTICES.md`.

## 0.2.4

- The native SDKs now report this package to the Sync API in the
  `X-Rivium-SDK` header (`react-native/<version> android/<version>` or
  `react-native/<version> ios/<version>`), so the Console can show which SDK
  and version a project uses. Exported `SDK_NAME` / `SDK_VERSION`.
- Uses rivium-sync-android 0.2.4 and RiviumSync (iOS) 0.2.3, installed
  automatically.

## 0.2.3

- With offline persistence on, writes made before the realtime connection is up
  (or without calling `connect()`) now go to the server instead of waiting in
  the local queue. They are queued only when the device is known to be offline
  (Android 0.2.3, iOS 0.2.2).

## 0.2.2

- Android: fixed a crash when the connection was closed while it was still
  opening, for example on a device with no internet.

## 0.2.1

- Added `tokenProvider`, `setTokenProvider()` and `refreshUserToken()`: the SDK
  gets and renews the user token itself.
- `connect()` can be called before sign-in when user tokens are required: the
  SDK waits for a token and then connects (`onAwaitingUserToken`,
  `isAwaitingUserToken()`).
- Setting a token for a different user reconnects as that user.

## 0.2.0

- Added `userToken` in the config and `setUserToken()`, so Security Rules can
  trust `auth.uid`. Your backend mints a short-lived token.
- Fixed Android installs: the native SDK dependency could not be resolved.
- Uses the 0.2.0 native SDKs, which fix `getAll()` stopping at 100 documents,
  deleted documents reappearing offline, stale reads at app start, and an app
  started offline never connecting.

## 0.1.0

- First release.
