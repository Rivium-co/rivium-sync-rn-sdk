# @rivium/sync-react-native

[![npm version](https://img.shields.io/npm/v/@rivium/sync-react-native.svg)](https://www.npmjs.com/package/@rivium/sync-react-native)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React Native SDK for RiviumSync - a Firebase Realtime Database alternative with MQTT-based sync.

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
  debugMode: true,
});

// Connect
await RiviumSync.connect();

// Add a document
const doc = await RiviumSync.addDocument({
  databaseId: 'my-db',
  collectionId: 'users',
  data: { name: 'Alice', age: 30 },
});

// Listen to collection changes
RiviumSync.listenCollection({
  databaseId: 'my-db',
  collectionId: 'users',
  onUpdate: (documents) => {
    console.log('Documents updated:', documents);
  },
});
```

## Features

- Real-time data synchronization via MQTT
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
