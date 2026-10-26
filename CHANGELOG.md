# Changelog

## 0.3.0

### Breaking

- `set()` now replaces the document: fields you leave out are removed. Before,
  it merged into the existing document. To keep merging, pass
  `{ merge: true }`: `todos.set('id', data, { merge: true })`.
  `WriteBatch.set()` takes the same option.

### Added

- Query listeners (`query.listen()`) now work on Android too.
- Listeners are checked by your security rules on the server and receive only
  the changes they are allowed to see.
- `listen(callback, onError)`, `listenDocument(id, callback, onError)` and
  `query.listen(callback, onError)` tell you why a listener stopped, with a
  `RiviumSyncError`: `query_not_allowed` when the rules do not allow the query
  (its `fields` name the filters that would make it allowed),
  `listener_revoked` when the rules stop allowing it, `permission_denied` when
  the rules do not allow reading it. After an error the listener receives
  nothing more. `onError` is optional.
- `query.get()` rejects with a `RiviumSyncError` with code `query_not_allowed`
  (and its `fields`) when the rules do not allow the query.
- `RiviumSyncError` and `SetOptions` are exported.
- Reads and writes the server refused reject with a `RiviumSyncError` whose
  `statusCode` is the HTTP status (403 when your security rules refused, 400 /
  404 / 422 for a request the server will not accept). Its `code` stays what it
  was (for example `DOCUMENT_ERROR`).
- `RiviumSync.onDocumentRejected((documentId, operation, error) => ...)`: with
  offline persistence, a queued write the server refuses (your security rules,
  invalid data) is dropped instead of retried, the local copy goes back to what
  the server has, and this callback tells you.

### Fixed

- A write made offline that could not be sent (no network, server error) is
  retried until it goes through. Before, it was given up after
  3 attempts and stayed on the device unsent, and a queued delete that failed
  this way was later sent as an update, so the document was not deleted.
- `maxSyncRetries` is deprecated and has no effect: writes are retried until they go through, and refused ones are
  rolled back.
- Android: queries filtering on a number or a boolean failed; filter values now
  keep their type.
- `listenDocument()` receives only its own document, not every change in the
  collection.
- With offline persistence on, the offline cache stands in only when the server
  cannot answer (no network, 401 while the user token is renewed, 408, 429,
  5xx). When it answers no (403 your security rules, 400 / 404 / 422), reads
  and writes reject with that answer, and a write is not queued. Deleting a
  document that does not exist succeeds.
- `getAll()` that your security rules do not allow rejects with
  `query_not_allowed` and its `fields`, as `query.get()` does.
- iOS: `disconnect()` goes offline straight away; a write made right after it
  is queued.
- Uses rivium-sync-android 0.3.0 and RiviumSync (iOS) 0.3.0, installed
  automatically.

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
