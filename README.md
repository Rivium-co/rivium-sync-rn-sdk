# @rivium/sync-react-native

[![npm version](https://img.shields.io/npm/v/@rivium/sync-react-native.svg)](https://www.npmjs.com/package/@rivium/sync-react-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React Native SDK for RiviumSync - a realtime database with offline-first sync.

## Installation

```bash
npm install @rivium/sync-react-native
# or
yarn add @rivium/sync-react-native
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

No additional setup required. The SDK automatically resolves from Maven Central.

## Quick Start

```typescript
import RiviumSync from '@rivium/sync-react-native';

// Initialize
await RiviumSync.init({
  apiKey: 'your-api-key',
});

// Connect
await RiviumSync.connect();

// Use the database and collection NAMES shown in Rivium Console (not UUIDs)
const users = RiviumSync.database('my-app').collection('users');

// Add a document
const doc = await users.add({ name: 'Alice', age: 30 });

// Listen to collection changes
const registration = users.listen((documents) => {
  console.log('Documents updated:', documents);
});
// Later: registration.remove();
```

> **Use names, not UUIDs.** `database()` and `collection()` take the database
> and collection **names** as shown in Rivium Console (e.g. `'my-app'`,
> `'todos'`). Names are resolved inside your API key's project. Realtime
> updates are published by name, so listeners only receive changes when you
> pass the names.

## Writing documents

`set()` writes a document with the id you choose. The document becomes exactly
the data you pass:

```typescript
await users.set('alice', { name: 'Alice', age: 30 });
```

To change some fields and keep the others, merge instead:

```typescript
await users.set('alice', { age: 31 }, { merge: true });
```

`WriteBatch.set()` takes the same `{ merge: true }` option.

## Listener errors

Your security rules decide what a listener may receive. Pass an error callback
to hear why a listener stopped; after an error it receives nothing more:

```typescript
import RiviumSync, { RiviumSyncError } from '@rivium/sync-react-native';

const registration = users
  .where('teamId', '==', teamId)
  .listen(
    (documents) => console.log('Team members:', documents.length),
    (error) => {
      if (error.code === RiviumSyncError.QUERY_NOT_ALLOWED) {
        // The rules do not allow this query. error.fields names the
        // filters that would make it allowed.
      } else if (error.code === RiviumSyncError.LISTENER_REVOKED) {
        // The rules no longer allow it (for example the user left the team).
      }
    }
  );
```

`listen()` and `listenDocument()` take the same error callback. A query's
`get()` rejects with a `RiviumSyncError` with code `query_not_allowed` (and its
`fields`) when the rules do not allow the query.

## Verified user identity

Security Rules check `auth.uid`. The API key ships inside your app, so the app
cannot be trusted to say who the user is - only your own server can. Have your
backend mint a short-lived user token and give the SDK a way to get it:

```ts
await RiviumSync.init({
  apiKey: 'rv_live_your_api_key',
  // Return null when no one is signed in.
  tokenProvider: () => myBackend.fetchRiviumToken(),
});

// When the user signs in or out:
await RiviumSync.refreshUserToken();
```

The SDK asks for a token at start and again before the old one expires. It is
the same Rivium user token Rivium Push and Rivium Chat use, so one function can
serve all three. Your backend mints it with your project's server secret, which
must stay on your server and never ship in an app.

If you would rather fetch the token yourself, call
`RiviumSync.setUserToken(token)` after `init` and again whenever you refresh it.

If your project has **Require signed user tokens** turned on in the Console, a
token is required; without it, requests are refused. You can still call
`connect()` before anyone is signed in: the SDK waits
(`RiviumSync.onAwaitingUserToken`) and connects by itself once it has a token.

## Features

- Real-time data synchronization
- Offline-first with automatic sync on reconnect
- Document CRUD operations
- Collection and document listeners
- Query support with filters, ordering, and pagination
- Batch operations
- Conflict resolution strategies

## Documentation

For full documentation, visit [rivium.co](https://rivium.co/).

## License

MIT
