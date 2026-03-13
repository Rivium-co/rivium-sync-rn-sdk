# RiviumSync React Native SDK Example

A comprehensive example app demonstrating all features of the RiviumSync React Native SDK.

## Features Demonstrated

- **CRUD Operations** - Create, Read, Update, Delete documents
- **Realtime Listeners** - Listen to collection and document changes in realtime
- **Query Operations** - Filter, sort, and paginate data
- **Batch Operations** - Atomic multi-document writes
- **Offline Persistence** - Work offline with automatic sync

## Setup

1. **Get your API credentials** from the RiviumSync dashboard:
   - Go to Projects > Your Project > API Keys
   - Copy your API Key
   - Note your Database ID

2. **Configure the app** by editing `src/config.ts`:

```typescript
export const AppConfig = {
  apiKey: 'your-api-key-here',
  databaseId: 'your-database-id-here',
  // ...
};
```

3. **Install dependencies**:

```bash
cd examples/react_native_example
npm install
```

4. **Install Watchman** (required for Metro bundler on macOS):

```bash
brew install watchman
```

If you get permission errors, run:
```bash
sudo mkdir -p ~/.local/state/watchman
sudo chown -R $(whoami):staff ~/.local
```

6. **iOS Setup**:

```bash
cd ios
pod install
cd ..
```

7. **Run the app**:

```bash
# iOS
npm run ios

# Android
npm run android
```

## Project Structure

```
src/
├── App.tsx                    # Main app with navigation
├── config.ts                  # API configuration
├── components/                # Reusable UI components
│   ├── CodeSnippet.tsx       # Expandable code examples
│   └── ResultCard.tsx        # Operation result display
└── screens/                   # Demo screens
    ├── HomeScreen.tsx        # Main navigation hub
    ├── CrudDemoScreen.tsx    # CRUD operations demo
    ├── RealtimeDemoScreen.tsx # Realtime listeners demo
    ├── QueryDemoScreen.tsx   # Query operations demo
    ├── BatchDemoScreen.tsx   # Batch operations demo
    └── OfflineDemoScreen.tsx # Offline persistence demo
```

## Demo Screens

### CRUD Operations
- Create new documents with title and description
- Read document details (ID, data, version, timestamps)
- Update existing documents
- Delete documents with confirmation
- Toggle completion status on todo items

### Query Operations
- Get all documents
- Filter by field with where clause
- Order results by any field
- Limit result count
- Compound queries (where + orderBy + limit)

### Batch Operations
- Batch create multiple documents
- Batch update all documents
- Batch delete documents
- Mixed operations (create + update + delete)
- All operations are atomic - all succeed or all fail

### Realtime Listeners
- Start/stop collection listener
- Watch specific documents
- Event log showing all realtime updates
- Test actions to trigger changes

### Offline Persistence
- Connection status monitoring
- Sync state display (Idle/Syncing/Offline/Error)
- Pending writes count
- Force sync pending operations
- Clear local cache

## SDK Usage Examples

### Initialize SDK

```typescript
import RiviumSync from '@rivium/sync-react-native';

await RiviumSync.init({
  apiKey: 'your-api-key',
  offlineEnabled: true,
  debugMode: true,
});

await RiviumSync.connect();
```

### CRUD Operations

```typescript
const db = RiviumSync.database('your-database-id');
const collection = db.collection('todos');

// Create
const doc = await collection.add({
  title: 'My Task',
  completed: false,
});

// Read
const doc = await collection.get('doc-id');

// Update
await collection.update('doc-id', { completed: true });

// Delete
await collection.delete('doc-id');
```

### Queries

```typescript
// Simple query
const results = await collection
  .where('status', '==', 'active')
  .get();

// Compound query
const results = await collection
  .where('sender', '==', 'Test User')
  .orderBy('timestamp', 'desc')
  .limit(10)
  .get();
```

### Batch Operations

```typescript
const batch = RiviumSync.batch();

batch.set(collection, 'doc1', { name: 'Alice' });
batch.update(collection, 'doc2', { status: 'active' });
batch.delete(collection, 'doc3');

await batch.commit(); // Atomic - all succeed or all fail
```

### Realtime Listeners

```typescript
// Listen to collection changes
const listener = collection.listen((documents) => {
  console.log('Collection updated:', documents.length);
});

// Listen to specific document
const docListener = collection.listenDocument('doc-id', (document) => {
  if (document) {
    console.log('Document updated:', document.data);
  } else {
    console.log('Document deleted');
  }
});

// Stop listening
listener.remove();
docListener.remove();
```

### Offline Support

```typescript
// Listen to sync state
RiviumSync.onSyncState((state) => {
  console.log('Sync state:', state); // 'idle' | 'syncing' | 'offline' | 'error'
});

// Listen to pending count
RiviumSync.onPendingCount((count) => {
  console.log('Pending operations:', count);
});

// Force sync
await RiviumSync.forceSyncNow();

// Clear cache
await RiviumSync.clearOfflineCache();
```

## Requirements

- React Native 0.72+
- iOS 13.0+
- Android API 23+ (Android 6.0)
- Node.js 18+

## License

MIT
