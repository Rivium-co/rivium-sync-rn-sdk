# Changelog

## Unreleased

- The native SDKs now report this package to the Sync API in the
  `X-Rivium-SDK` header (`react-native/<version> android/<version>` or
  `react-native/<version> ios/<version>`), so the Console can show which SDK
  and version a project uses. Exported `SDK_NAME` / `SDK_VERSION`
  (`src/version.ts`, generated from package.json by `scripts/sync-version.js`).
- Needs the native SDKs that accept the wrapper identity: the package now
  depends on rivium-sync-android 0.2.4 and RiviumSync (iOS) ~> 0.2.3, which
  must be released first.

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
