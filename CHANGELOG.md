# Changelog

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
