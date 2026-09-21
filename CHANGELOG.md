# Changelog

## 0.2.0

- Added `userToken` in the config and `setUserToken()`, so Security Rules can
  trust `auth.uid`. Your backend mints a short-lived token.
- Fixed Android installs: the native SDK dependency could not be resolved.
- Uses the 0.2.0 native SDKs, which fix `getAll()` stopping at 100 documents,
  deleted documents reappearing offline, stale reads at app start, and an app
  started offline never connecting.

## 0.1.0

- First release.
