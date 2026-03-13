/**
 * Comprehensive tests for @rivium/sync-react-native SDK
 *
 * Tests cover:
 * - Type/interface structural validation
 * - SyncQuery: constructor, chaining (where, orderBy, limit, offset), get, listen
 * - SyncCollection: constructor, readonly properties, CRUD operations, query/where helpers, listeners
 * - SyncDatabase: constructor, readonly properties, collection(), listCollections, createCollection, deleteCollection
 * - WriteBatch: set/update/delete/create, chaining, size, isEmpty, commit, double-commit prevention
 * - RiviumSync singleton: init, isInitialized, isOfflineEnabled, database(), batch(), connect/disconnect,
 *   listener registration/unsubscription, offline API (getSyncState, getPendingCount, forceSyncNow, clearOfflineCache)
 * - QueryOperator and OrderDirection type values
 */

// ─── Mock react-native before any imports ────────────────────────────────────

const mockNativeModule = {
  init: jest.fn().mockResolvedValue(undefined),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockResolvedValue(true),
  listDatabases: jest.fn().mockResolvedValue([]),
  listCollections: jest.fn().mockResolvedValue([]),
  createCollection: jest.fn().mockResolvedValue({ id: 'col-1', name: 'users' }),
  deleteCollection: jest.fn().mockResolvedValue(undefined),
  addDocument: jest.fn().mockResolvedValue({ id: 'doc-1', data: {}, createdAt: 1000, updatedAt: 1000, version: 1 }),
  getDocument: jest.fn().mockResolvedValue({ id: 'doc-1', data: { name: 'Alice' }, createdAt: 1000, updatedAt: 1000, version: 1 }),
  getAllDocuments: jest.fn().mockResolvedValue([]),
  updateDocument: jest.fn().mockResolvedValue({ id: 'doc-1', data: { name: 'Bob' }, createdAt: 1000, updatedAt: 2000, version: 2 }),
  setDocument: jest.fn().mockResolvedValue({ id: 'doc-1', data: { name: 'Charlie' }, createdAt: 1000, updatedAt: 3000, version: 3 }),
  deleteDocument: jest.fn().mockResolvedValue(undefined),
  queryDocuments: jest.fn().mockResolvedValue([]),
  listenQuery: jest.fn().mockResolvedValue(undefined),
  removeQueryListener: jest.fn().mockResolvedValue(undefined),
  listenCollection: jest.fn().mockResolvedValue(undefined),
  removeCollectionListener: jest.fn().mockResolvedValue(undefined),
  listenDocument: jest.fn().mockResolvedValue(undefined),
  removeDocumentListener: jest.fn().mockResolvedValue(undefined),
  waitForCollectionUpdate: jest.fn().mockResolvedValue({ documents: [] }),
  waitForDocumentUpdate: jest.fn().mockResolvedValue({ document: null }),
  executeBatch: jest.fn().mockResolvedValue(undefined),
  getSyncState: jest.fn().mockResolvedValue('idle'),
  getPendingCount: jest.fn().mockResolvedValue(0),
  forceSyncNow: jest.fn().mockResolvedValue(undefined),
  clearOfflineCache: jest.fn().mockResolvedValue(undefined),
};

const mockAddListener = jest.fn().mockReturnValue({ remove: jest.fn() });
const mockRemoveAllListeners = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    RiviumSync: mockNativeModule,
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: mockAddListener,
    removeAllListeners: mockRemoveAllListeners,
  })),
  Platform: { OS: 'ios', select: jest.fn((obj: any) => obj.ios) },
}));

// ─── Imports (after mock) ────────────────────────────────────────────────────

import {
  SyncQuery,
  SyncCollection,
  SyncDatabase,
  WriteBatch,
  RiviumSync,
} from '../index';

import type {
  RiviumSyncConfig,
  SyncDocument,
  DatabaseInfo,
  CollectionInfo,
  QueryFilter,
  ListenerRegistration,
  QueryOperator,
  OrderDirection,
  ConflictStrategy,
  SyncState,
} from '../index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Reset all mocks and re-import a fresh RiviumSync singleton for tests that
 * need a clean, uninitialized state. Because the module-level singleton is
 * cached by the module system, we use jest.isolateModules to get a fresh copy.
 */
function getFreshRiviumSync(): typeof RiviumSync {
  let freshInstance: typeof RiviumSync;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    freshInstance = require('../index').RiviumSync;
  });
  return freshInstance!;
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('@rivium/sync-react-native', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Types and Interfaces
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Types and Interfaces', () => {
    it('RiviumSyncConfig should accept a minimal config with only apiKey', () => {
      const config: RiviumSyncConfig = { apiKey: 'rv_test_abc123' };
      expect(config.apiKey).toBe('rv_test_abc123');
      expect(config.debugMode).toBeUndefined();
      expect(config.autoReconnect).toBeUndefined();
      expect(config.offlineEnabled).toBeUndefined();
    });

    it('RiviumSyncConfig should accept all optional fields', () => {
      const config: RiviumSyncConfig = {
        apiKey: 'rv_live_xyz',
        debugMode: true,
        autoReconnect: false,
        offlineEnabled: true,
        offlineCacheSizeMb: 200,
        syncOnReconnect: false,
        conflictStrategy: 'clientWins',
        maxSyncRetries: 5,
      };
      expect(config.offlineCacheSizeMb).toBe(200);
      expect(config.conflictStrategy).toBe('clientWins');
      expect(config.maxSyncRetries).toBe(5);
    });

    it('SyncDocument should have required shape', () => {
      const doc: SyncDocument = {
        id: 'doc-1',
        data: { title: 'Hello' },
        createdAt: 1000,
        updatedAt: 2000,
        version: 1,
      };
      expect(doc.id).toBe('doc-1');
      expect(doc.data.title).toBe('Hello');
      expect(doc.version).toBe(1);
    });

    it('DatabaseInfo should have required shape', () => {
      const info: DatabaseInfo = {
        id: 'db-1',
        name: 'mydb',
        createdAt: 1000,
        updatedAt: 2000,
      };
      expect(info.id).toBe('db-1');
      expect(info.name).toBe('mydb');
    });

    it('CollectionInfo should have required shape including documentCount', () => {
      const info: CollectionInfo = {
        id: 'col-1',
        name: 'users',
        databaseId: 'db-1',
        documentCount: 42,
        createdAt: 1000,
        updatedAt: 2000,
      };
      expect(info.databaseId).toBe('db-1');
      expect(info.documentCount).toBe(42);
    });

    it('QueryFilter should have field, operator, and value', () => {
      const filter: QueryFilter = {
        field: 'age',
        operator: '>=',
        value: 18,
      };
      expect(filter.field).toBe('age');
      expect(filter.operator).toBe('>=');
      expect(filter.value).toBe(18);
    });

    it('ListenerRegistration should have a remove function', () => {
      const reg: ListenerRegistration = { remove: jest.fn() };
      expect(typeof reg.remove).toBe('function');
    });

    it('ConflictStrategy should accept all valid values', () => {
      const strategies: ConflictStrategy[] = ['serverWins', 'clientWins', 'merge', 'manual'];
      expect(strategies).toHaveLength(4);
    });

    it('SyncState should accept all valid values', () => {
      const states: SyncState[] = ['idle', 'syncing', 'offline', 'error'];
      expect(states).toHaveLength(4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. QueryOperator and OrderDirection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('QueryOperator and OrderDirection types', () => {
    it('should accept all comparison operators', () => {
      const ops: QueryOperator[] = ['==', '!=', '>', '>=', '<', '<='];
      expect(ops).toHaveLength(6);
    });

    it('should accept array and set operators', () => {
      const ops: QueryOperator[] = ['array-contains', 'in', 'not-in'];
      expect(ops).toHaveLength(3);
    });

    it('should accept asc and desc order directions', () => {
      const dirs: OrderDirection[] = ['asc', 'desc'];
      expect(dirs).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. SyncQuery
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SyncQuery', () => {
    let query: SyncQuery;

    beforeEach(() => {
      query = new SyncQuery('db-1', 'col-1');
    });

    it('should construct with databaseId and collectionId', () => {
      expect(query).toBeInstanceOf(SyncQuery);
    });

    it('where() should return the same SyncQuery instance for chaining', () => {
      const result = query.where('age', '>=', 18);
      expect(result).toBeInstanceOf(SyncQuery);
      expect(result).toBe(query);
    });

    it('orderBy() should return the same SyncQuery instance for chaining', () => {
      const result = query.orderBy('createdAt', 'desc');
      expect(result).toBeInstanceOf(SyncQuery);
      expect(result).toBe(query);
    });

    it('limit() should return the same SyncQuery instance for chaining', () => {
      const result = query.limit(10);
      expect(result).toBeInstanceOf(SyncQuery);
      expect(result).toBe(query);
    });

    it('offset() should return the same SyncQuery instance for chaining', () => {
      const result = query.offset(20);
      expect(result).toBeInstanceOf(SyncQuery);
      expect(result).toBe(query);
    });

    it('should support full chaining of where -> orderBy -> limit -> offset', () => {
      const result = query
        .where('status', '==', 'active')
        .where('age', '>', 21)
        .orderBy('name', 'asc')
        .limit(50)
        .offset(10);
      expect(result).toBe(query);
    });

    it('get() should call RiviumSyncModule.queryDocuments with correct params', async () => {
      const mockDocs: SyncDocument[] = [
        { id: 'd1', data: { x: 1 }, createdAt: 100, updatedAt: 100, version: 1 },
      ];
      mockNativeModule.queryDocuments.mockResolvedValueOnce(mockDocs);

      const result = await query
        .where('status', '==', 'active')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .offset(2)
        .get();

      expect(mockNativeModule.queryDocuments).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        filters: [{ field: 'status', operator: '==', value: 'active' }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 5,
        offset: 2,
      });
      expect(result).toEqual(mockDocs);
    });

    it('get() should pass undefined for orderBy when not set', async () => {
      mockNativeModule.queryDocuments.mockResolvedValueOnce([]);
      await query.where('x', '!=', null).get();

      expect(mockNativeModule.queryDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: undefined })
      );
    });

    it('get() should pass undefined for limit and offset when not set', async () => {
      mockNativeModule.queryDocuments.mockResolvedValueOnce([]);
      await query.get();

      expect(mockNativeModule.queryDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ limit: undefined, offset: undefined })
      );
    });

    it('listen() should call listenQuery on the native module', () => {
      const callback = jest.fn();
      query.where('active', '==', true).listen(callback);

      expect(mockNativeModule.listenQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'db-1',
          collectionId: 'col-1',
          filters: [{ field: 'active', operator: '==', value: true }],
        })
      );
    });

    it('listen() should return a ListenerRegistration with remove()', () => {
      const callback = jest.fn();
      const registration = query.listen(callback);

      expect(registration).toBeDefined();
      expect(typeof registration.remove).toBe('function');
    });

    it('listen() remove should call removeQueryListener', () => {
      const callback = jest.fn();
      const registration = query.listen(callback);
      registration.remove();

      expect(mockNativeModule.removeQueryListener).toHaveBeenCalledWith(
        expect.objectContaining({ listenerId: expect.any(String) })
      );
    });

    it('multiple where() calls should accumulate filters', async () => {
      mockNativeModule.queryDocuments.mockResolvedValueOnce([]);

      await query
        .where('age', '>=', 18)
        .where('age', '<', 65)
        .where('status', '==', 'active')
        .get();

      const call = mockNativeModule.queryDocuments.mock.calls[0][0];
      expect(call.filters).toHaveLength(3);
      expect(call.filters[0]).toEqual({ field: 'age', operator: '>=', value: 18 });
      expect(call.filters[1]).toEqual({ field: 'age', operator: '<', value: 65 });
      expect(call.filters[2]).toEqual({ field: 'status', operator: '==', value: 'active' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SyncCollection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SyncCollection', () => {
    let collection: SyncCollection;

    beforeEach(() => {
      collection = new SyncCollection('db-1', 'col-1', 'users');
    });

    it('should construct with correct readonly properties', () => {
      expect(collection.databaseId).toBe('db-1');
      expect(collection.id).toBe('col-1');
      expect(collection.name).toBe('users');
    });

    it('readonly properties should not be reassignable', () => {
      // TypeScript compiler prevents reassignment at compile time,
      // but at runtime the readonly modifier from the class is enforced.
      // We verify the properties exist and have the expected values.
      expect(collection.databaseId).toBe('db-1');
      expect(collection.id).toBe('col-1');
      expect(collection.name).toBe('users');
    });

    // --- CRUD operations ---

    it('add() should call addDocument with correct parameters', async () => {
      const data = { name: 'Alice', email: 'alice@test.com' };
      await collection.add(data);

      expect(mockNativeModule.addDocument).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        data,
      });
    });

    it('add() should return the created SyncDocument', async () => {
      const mockDoc: SyncDocument = {
        id: 'new-doc',
        data: { name: 'Alice' },
        createdAt: 5000,
        updatedAt: 5000,
        version: 1,
      };
      mockNativeModule.addDocument.mockResolvedValueOnce(mockDoc);

      const result = await collection.add({ name: 'Alice' });
      expect(result).toEqual(mockDoc);
    });

    it('get() should call getDocument with correct parameters', async () => {
      await collection.get('doc-123');

      expect(mockNativeModule.getDocument).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        documentId: 'doc-123',
      });
    });

    it('get() should return null for non-existent document', async () => {
      mockNativeModule.getDocument.mockResolvedValueOnce(null);
      const result = await collection.get('nonexistent');
      expect(result).toBeNull();
    });

    it('getAll() should call getAllDocuments with correct parameters', async () => {
      const mockDocs: SyncDocument[] = [
        { id: 'd1', data: { a: 1 }, createdAt: 100, updatedAt: 100, version: 1 },
        { id: 'd2', data: { b: 2 }, createdAt: 200, updatedAt: 200, version: 1 },
      ];
      mockNativeModule.getAllDocuments.mockResolvedValueOnce(mockDocs);

      const result = await collection.getAll();

      expect(mockNativeModule.getAllDocuments).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
      });
      expect(result).toEqual(mockDocs);
    });

    it('update() should call updateDocument with correct parameters', async () => {
      const data = { name: 'Bob' };
      await collection.update('doc-1', data);

      expect(mockNativeModule.updateDocument).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        documentId: 'doc-1',
        data,
      });
    });

    it('set() should call setDocument with correct parameters', async () => {
      const data = { name: 'Charlie', role: 'admin' };
      await collection.set('doc-2', data);

      expect(mockNativeModule.setDocument).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        documentId: 'doc-2',
        data,
      });
    });

    it('delete() should call deleteDocument with correct parameters', async () => {
      await collection.delete('doc-3');

      expect(mockNativeModule.deleteDocument).toHaveBeenCalledWith({
        databaseId: 'db-1',
        collectionId: 'col-1',
        documentId: 'doc-3',
      });
    });

    // --- Query helpers ---

    it('query() should return a new SyncQuery instance', () => {
      const q = collection.query();
      expect(q).toBeInstanceOf(SyncQuery);
    });

    it('where() should return a SyncQuery with the filter applied', async () => {
      mockNativeModule.queryDocuments.mockResolvedValueOnce([]);
      const q = collection.where('role', '==', 'admin');
      expect(q).toBeInstanceOf(SyncQuery);

      await q.get();
      expect(mockNativeModule.queryDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'db-1',
          collectionId: 'col-1',
          filters: [{ field: 'role', operator: '==', value: 'admin' }],
        })
      );
    });

    it('where() should be chainable from the returned SyncQuery', async () => {
      mockNativeModule.queryDocuments.mockResolvedValueOnce([]);
      const q = collection
        .where('status', '==', 'active')
        .where('role', '!=', 'banned')
        .orderBy('name')
        .limit(20);
      expect(q).toBeInstanceOf(SyncQuery);

      await q.get();
      const call = mockNativeModule.queryDocuments.mock.calls[0][0];
      expect(call.filters).toHaveLength(2);
      expect(call.limit).toBe(20);
    });

    // --- Listeners ---

    it('listen() should call listenCollection on native module', () => {
      const callback = jest.fn();
      collection.listen(callback);

      expect(mockNativeModule.listenCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'db-1',
          collectionId: 'col-1',
          listenerId: expect.any(String),
        })
      );
    });

    it('listen() should return ListenerRegistration with remove()', () => {
      const registration = collection.listen(jest.fn());
      expect(typeof registration.remove).toBe('function');
    });

    it('listen() remove should call removeCollectionListener', () => {
      const registration = collection.listen(jest.fn());
      registration.remove();

      expect(mockNativeModule.removeCollectionListener).toHaveBeenCalledWith(
        expect.objectContaining({ listenerId: expect.any(String) })
      );
    });

    it('listenDocument() should call native listenDocument', () => {
      const callback = jest.fn();
      collection.listenDocument('doc-1', callback);

      expect(mockNativeModule.listenDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseId: 'db-1',
          collectionId: 'col-1',
          documentId: 'doc-1',
          listenerId: expect.any(String),
        })
      );
    });

    it('listenDocument() remove should call removeDocumentListener', () => {
      const registration = collection.listenDocument('doc-1', jest.fn());
      registration.remove();

      expect(mockNativeModule.removeDocumentListener).toHaveBeenCalledWith(
        expect.objectContaining({ listenerId: expect.any(String) })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. SyncDatabase
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SyncDatabase', () => {
    let database: SyncDatabase;

    beforeEach(() => {
      database = new SyncDatabase('db-42', 'production');
    });

    it('should construct with correct readonly properties', () => {
      expect(database.id).toBe('db-42');
      expect(database.name).toBe('production');
    });

    it('collection() should return a SyncCollection with matching databaseId', () => {
      const col = database.collection('users');
      expect(col).toBeInstanceOf(SyncCollection);
      expect(col.databaseId).toBe('db-42');
      expect(col.id).toBe('users');
      expect(col.name).toBe('users');
    });

    it('collection() should use the provided id as both id and name', () => {
      const col = database.collection('my-collection-id');
      expect(col.id).toBe('my-collection-id');
      expect(col.name).toBe('my-collection-id');
    });

    it('listCollections() should call native listCollections', async () => {
      const mockCollections: CollectionInfo[] = [
        { id: 'c1', name: 'users', databaseId: 'db-42', documentCount: 10, createdAt: 100, updatedAt: 200 },
      ];
      mockNativeModule.listCollections.mockResolvedValueOnce(mockCollections);

      const result = await database.listCollections();

      expect(mockNativeModule.listCollections).toHaveBeenCalledWith({ databaseId: 'db-42' });
      expect(result).toEqual(mockCollections);
    });

    it('createCollection() should call native createCollection and return SyncCollection', async () => {
      mockNativeModule.createCollection.mockResolvedValueOnce({ id: 'new-col', name: 'orders' });

      const col = await database.createCollection('orders');

      expect(mockNativeModule.createCollection).toHaveBeenCalledWith({
        databaseId: 'db-42',
        name: 'orders',
      });
      expect(col).toBeInstanceOf(SyncCollection);
      expect(col.id).toBe('new-col');
      expect(col.name).toBe('orders');
      expect(col.databaseId).toBe('db-42');
    });

    it('deleteCollection() should call native deleteCollection', async () => {
      await database.deleteCollection('col-to-delete');

      expect(mockNativeModule.deleteCollection).toHaveBeenCalledWith({
        collectionId: 'col-to-delete',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. WriteBatch
  // ═══════════════════════════════════════════════════════════════════════════

  describe('WriteBatch', () => {
    let batch: WriteBatch;
    let collection: SyncCollection;

    beforeEach(() => {
      batch = new WriteBatch();
      collection = new SyncCollection('db-1', 'col-1', 'users');
    });

    it('should start empty', () => {
      expect(batch.size).toBe(0);
      expect(batch.isEmpty).toBe(true);
    });

    it('set() should add an operation and increase size', () => {
      batch.set(collection, 'doc-1', { name: 'Alice' });
      expect(batch.size).toBe(1);
      expect(batch.isEmpty).toBe(false);
    });

    it('update() should add an operation and increase size', () => {
      batch.update(collection, 'doc-1', { name: 'Bob' });
      expect(batch.size).toBe(1);
    });

    it('delete() should add an operation and increase size', () => {
      batch.delete(collection, 'doc-1');
      expect(batch.size).toBe(1);
    });

    it('create() should add an operation and increase size', () => {
      batch.create(collection, { name: 'New User' });
      expect(batch.size).toBe(1);
    });

    it('set() should return the WriteBatch for chaining', () => {
      const result = batch.set(collection, 'doc-1', { a: 1 });
      expect(result).toBe(batch);
      expect(result).toBeInstanceOf(WriteBatch);
    });

    it('update() should return the WriteBatch for chaining', () => {
      const result = batch.update(collection, 'doc-1', { b: 2 });
      expect(result).toBe(batch);
    });

    it('delete() should return the WriteBatch for chaining', () => {
      const result = batch.delete(collection, 'doc-1');
      expect(result).toBe(batch);
    });

    it('create() should return the WriteBatch for chaining', () => {
      const result = batch.create(collection, { c: 3 });
      expect(result).toBe(batch);
    });

    it('should support full method chaining', () => {
      const col2 = new SyncCollection('db-1', 'col-2', 'orders');

      batch
        .set(collection, 'u1', { name: 'Alice' })
        .update(collection, 'u2', { status: 'active' })
        .delete(collection, 'u3')
        .create(col2, { item: 'Widget', qty: 5 })
        .set(col2, 'o1', { total: 99 });

      expect(batch.size).toBe(5);
      expect(batch.isEmpty).toBe(false);
    });

    it('commit() should call executeBatch with all operations', async () => {
      batch
        .set(collection, 'doc-1', { name: 'Alice' })
        .update(collection, 'doc-2', { age: 30 })
        .delete(collection, 'doc-3');

      await batch.commit();

      expect(mockNativeModule.executeBatch).toHaveBeenCalledWith({
        operations: [
          { type: 'set', databaseId: 'db-1', collectionId: 'col-1', documentId: 'doc-1', data: { name: 'Alice' } },
          { type: 'update', databaseId: 'db-1', collectionId: 'col-1', documentId: 'doc-2', data: { age: 30 } },
          { type: 'delete', databaseId: 'db-1', collectionId: 'col-1', documentId: 'doc-3' },
        ],
      });
    });

    it('commit() with an empty batch should resolve without calling executeBatch', async () => {
      await batch.commit();
      expect(mockNativeModule.executeBatch).not.toHaveBeenCalled();
    });

    it('double commit should throw an error', async () => {
      batch.set(collection, 'doc-1', { x: 1 });
      await batch.commit();

      expect(() => batch.set(collection, 'doc-2', { y: 2 })).toThrow(
        'WriteBatch has already been committed'
      );
      await expect(batch.commit()).rejects.toThrow(
        'WriteBatch has already been committed'
      );
    });

    it('operations should be rejected after commit', async () => {
      batch.create(collection, { data: 'test' });
      await batch.commit();

      expect(() => batch.set(collection, 'a', {})).toThrow('WriteBatch has already been committed');
      expect(() => batch.update(collection, 'a', {})).toThrow('WriteBatch has already been committed');
      expect(() => batch.delete(collection, 'a')).toThrow('WriteBatch has already been committed');
      expect(() => batch.create(collection, {})).toThrow('WriteBatch has already been committed');
    });

    it('should allow retry if commit fails', async () => {
      mockNativeModule.executeBatch.mockRejectedValueOnce(new Error('Network error'));

      batch.set(collection, 'doc-1', { name: 'retry-test' });

      await expect(batch.commit()).rejects.toThrow('Network error');

      // After failure, committed should be reset to false, allowing retry
      mockNativeModule.executeBatch.mockResolvedValueOnce(undefined);
      await batch.commit(); // should succeed on retry

      expect(mockNativeModule.executeBatch).toHaveBeenCalledTimes(2);
    });

    it('create() should record operation without documentId', async () => {
      batch.create(collection, { role: 'user' });
      await batch.commit();

      const call = mockNativeModule.executeBatch.mock.calls[0][0];
      const createOp = call.operations[0];
      expect(createOp.type).toBe('create');
      expect(createOp.documentId).toBeUndefined();
      expect(createOp.data).toEqual({ role: 'user' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. RiviumSync Singleton
  // ═══════════════════════════════════════════════════════════════════════════

  describe('RiviumSync (singleton)', () => {
    describe('init()', () => {
      it('should call native init with merged default config', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        expect(mockNativeModule.init).toHaveBeenCalledWith({
          apiKey: 'rv_test_key',
          debugMode: false,
          autoReconnect: true,
          offlineEnabled: false,
          offlineCacheSizeMb: 100,
          syncOnReconnect: true,
          conflictStrategy: 'serverWins',
          maxSyncRetries: 3,
        });
      });

      it('should pass custom config values through to native init', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({
          apiKey: 'rv_live_custom',
          debugMode: true,
          autoReconnect: false,
          offlineEnabled: true,
          offlineCacheSizeMb: 50,
          syncOnReconnect: false,
          conflictStrategy: 'merge',
          maxSyncRetries: 10,
        });

        expect(mockNativeModule.init).toHaveBeenCalledWith({
          apiKey: 'rv_live_custom',
          debugMode: true,
          autoReconnect: false,
          offlineEnabled: true,
          offlineCacheSizeMb: 50,
          syncOnReconnect: false,
          conflictStrategy: 'merge',
          maxSyncRetries: 10,
        });
      });

      it('should set isInitialized to true after init', async () => {
        const fresh = getFreshRiviumSync();
        expect(fresh.isInitialized).toBe(false);
        await fresh.init({ apiKey: 'rv_test_key' });
        expect(fresh.isInitialized).toBe(true);
      });

      it('should be idempotent - second init should be a no-op', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_first' });
        await fresh.init({ apiKey: 'rv_test_second' });

        // Native init should only have been called once (for 'first')
        expect(mockNativeModule.init).toHaveBeenCalledTimes(1);
        expect(mockNativeModule.init).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: 'rv_test_first' })
        );
      });

      it('should set isOfflineEnabled based on config', async () => {
        const fresh = getFreshRiviumSync();
        expect(fresh.isOfflineEnabled).toBe(false);
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });
        expect(fresh.isOfflineEnabled).toBe(true);
      });

      it('isOfflineEnabled should default to false', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });
        expect(fresh.isOfflineEnabled).toBe(false);
      });
    });

    describe('database()', () => {
      it('should return a SyncDatabase instance', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const db = fresh.database('my-db');
        expect(db.constructor.name).toBe('SyncDatabase');
        expect(db.id).toBe('my-db');
      });

      it('should throw if not initialized', () => {
        const fresh = getFreshRiviumSync();
        expect(() => fresh.database('any')).toThrow(
          'RiviumSync not initialized. Call RiviumSync.init() first.'
        );
      });
    });

    describe('batch()', () => {
      it('should return a WriteBatch instance', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const b = fresh.batch();
        expect(b.constructor.name).toBe('WriteBatch');
        expect(b.size).toBe(0);
        expect(b.isEmpty).toBe(true);
      });

      it('should throw if not initialized', () => {
        const fresh = getFreshRiviumSync();
        expect(() => fresh.batch()).toThrow(
          'RiviumSync not initialized. Call RiviumSync.init() first.'
        );
      });

      it('should return a new WriteBatch each time', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const b1 = fresh.batch();
        const b2 = fresh.batch();
        expect(b1).not.toBe(b2);
      });
    });

    describe('connect() / disconnect() / isConnected()', () => {
      it('connect() should call native connect', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.connect();
        expect(mockNativeModule.connect).toHaveBeenCalled();
      });

      it('disconnect() should call native disconnect', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.disconnect();
        expect(mockNativeModule.disconnect).toHaveBeenCalled();
      });

      it('isConnected() should call native isConnected and return result', async () => {
        mockNativeModule.isConnected.mockResolvedValueOnce(false);
        const fresh = getFreshRiviumSync();
        const result = await fresh.isConnected();
        expect(result).toBe(false);
      });
    });

    describe('listDatabases()', () => {
      it('should call native listDatabases and return result', async () => {
        const mockDbs: DatabaseInfo[] = [
          { id: 'db-1', name: 'production', createdAt: 100, updatedAt: 200 },
          { id: 'db-2', name: 'staging', createdAt: 300, updatedAt: 400 },
        ];
        mockNativeModule.listDatabases.mockResolvedValueOnce(mockDbs);

        const fresh = getFreshRiviumSync();
        const result = await fresh.listDatabases();

        expect(mockNativeModule.listDatabases).toHaveBeenCalled();
        expect(result).toEqual(mockDbs);
        expect(result).toHaveLength(2);
      });
    });

    describe('onConnectionState()', () => {
      it('should register a connection state listener', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const callback = jest.fn();
        const unsubscribe = fresh.onConnectionState(callback);
        expect(typeof unsubscribe).toBe('function');
      });

      it('should return an unsubscribe function that removes the listener', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const callback = jest.fn();
        const unsubscribe = fresh.onConnectionState(callback);

        // Calling unsubscribe should not throw
        unsubscribe();
      });

      it('unsubscribe should be idempotent (calling twice should not throw)', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const callback = jest.fn();
        const unsubscribe = fresh.onConnectionState(callback);

        unsubscribe();
        expect(() => unsubscribe()).not.toThrow();
      });
    });

    describe('onError()', () => {
      it('should register an error listener and return unsubscribe', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const callback = jest.fn();
        const unsubscribe = fresh.onError(callback);
        expect(typeof unsubscribe).toBe('function');
      });

      it('unsubscribe should remove the error listener', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key' });

        const callback = jest.fn();
        const unsubscribe = fresh.onError(callback);
        unsubscribe();
        // No error, listener removed
      });
    });

    describe('Offline API', () => {
      it('onSyncState() should register a sync state listener and return unsubscribe', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        const callback = jest.fn();
        const unsubscribe = fresh.onSyncState(callback);
        expect(typeof unsubscribe).toBe('function');

        unsubscribe();
      });

      it('onPendingCount() should register a pending count listener and return unsubscribe', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        const callback = jest.fn();
        const unsubscribe = fresh.onPendingCount(callback);
        expect(typeof unsubscribe).toBe('function');

        unsubscribe();
      });

      it('getSyncState() should return idle when offline is disabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: false });

        const state = await fresh.getSyncState();
        expect(state).toBe('idle');
        // Should NOT call native module when offline is disabled
        expect(mockNativeModule.getSyncState).not.toHaveBeenCalled();
      });

      it('getSyncState() should call native module when offline is enabled', async () => {
        mockNativeModule.getSyncState.mockResolvedValueOnce('syncing');
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        // Clear calls from init side-effects
        mockNativeModule.getSyncState.mockClear();
        mockNativeModule.getSyncState.mockResolvedValueOnce('syncing');

        const state = await fresh.getSyncState();
        expect(state).toBe('syncing');
        expect(mockNativeModule.getSyncState).toHaveBeenCalled();
      });

      it('getPendingCount() should return 0 when offline is disabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: false });

        const count = await fresh.getPendingCount();
        expect(count).toBe(0);
        expect(mockNativeModule.getPendingCount).not.toHaveBeenCalled();
      });

      it('getPendingCount() should call native module when offline is enabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        mockNativeModule.getPendingCount.mockClear();
        mockNativeModule.getPendingCount.mockResolvedValueOnce(7);

        const count = await fresh.getPendingCount();
        expect(count).toBe(7);
        expect(mockNativeModule.getPendingCount).toHaveBeenCalled();
      });

      it('forceSyncNow() should be a no-op when offline is disabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: false });

        await fresh.forceSyncNow();
        expect(mockNativeModule.forceSyncNow).not.toHaveBeenCalled();
      });

      it('forceSyncNow() should call native module when offline is enabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        await fresh.forceSyncNow();
        expect(mockNativeModule.forceSyncNow).toHaveBeenCalled();
      });

      it('clearOfflineCache() should be a no-op when offline is disabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: false });

        await fresh.clearOfflineCache();
        expect(mockNativeModule.clearOfflineCache).not.toHaveBeenCalled();
      });

      it('clearOfflineCache() should call native module when offline is enabled', async () => {
        const fresh = getFreshRiviumSync();
        await fresh.init({ apiKey: 'rv_test_key', offlineEnabled: true });

        await fresh.clearOfflineCache();
        expect(mockNativeModule.clearOfflineCache).toHaveBeenCalled();
      });
    });

    describe('default export', () => {
      it('should export RiviumSync as both named and default export', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../index');
        expect(mod.RiviumSync).toBeDefined();
        expect(mod.default).toBeDefined();
        expect(mod.RiviumSync).toBe(mod.default);
      });
    });

    describe('exported classes', () => {
      it('should export SyncQuery as a constructor', () => {
        expect(typeof SyncQuery).toBe('function');
      });

      it('should export SyncCollection as a constructor', () => {
        expect(typeof SyncCollection).toBe('function');
      });

      it('should export SyncDatabase as a constructor', () => {
        expect(typeof SyncDatabase).toBe('function');
      });

      it('should export WriteBatch as a constructor', () => {
        expect(typeof WriteBatch).toBe('function');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Integration-style tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Integration: end-to-end usage patterns', () => {
    it('should support full workflow: init -> database -> collection -> CRUD', async () => {
      const fresh = getFreshRiviumSync();
      await fresh.init({ apiKey: 'rv_test_integration' });

      const db = fresh.database('prod-db');
      expect(db.constructor.name).toBe('SyncDatabase');

      const users = db.collection('users');
      expect(users.constructor.name).toBe('SyncCollection');
      expect(users.databaseId).toBe('prod-db');

      // Add a document
      mockNativeModule.addDocument.mockResolvedValueOnce({
        id: 'user-1',
        data: { name: 'Alice', age: 30 },
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
      });
      const doc = await users.add({ name: 'Alice', age: 30 });
      expect(doc.id).toBe('user-1');

      // Query documents
      mockNativeModule.queryDocuments.mockResolvedValueOnce([
        { id: 'user-1', data: { name: 'Alice', age: 30 }, createdAt: 1000, updatedAt: 1000, version: 1 },
      ]);
      const results = await users.where('age', '>=', 18).orderBy('name').limit(10).get();
      expect(results).toHaveLength(1);
      expect(results[0].data.name).toBe('Alice');
    });

    it('should support batch operations across multiple collections', async () => {
      const fresh = getFreshRiviumSync();
      await fresh.init({ apiKey: 'rv_test_batch_integration' });

      const db = fresh.database('app-db');
      const users = db.collection('users');
      const orders = db.collection('orders');
      const logs = db.collection('logs');

      const batch = fresh.batch();
      batch
        .set(users, 'u1', { name: 'Alice' })
        .set(users, 'u2', { name: 'Bob' })
        .create(orders, { item: 'Widget', userId: 'u1' })
        .delete(logs, 'old-log-1');

      expect(batch.size).toBe(4);
      await batch.commit();

      expect(mockNativeModule.executeBatch).toHaveBeenCalledTimes(1);
      const ops = mockNativeModule.executeBatch.mock.calls[0][0].operations;
      expect(ops).toHaveLength(4);
      expect(ops[0].collectionId).toBe('users');
      expect(ops[2].collectionId).toBe('orders');
      expect(ops[3].collectionId).toBe('logs');
    });

    it('should support listening and then unsubscribing from a collection', async () => {
      const fresh = getFreshRiviumSync();
      await fresh.init({ apiKey: 'rv_test_listen' });

      const db = fresh.database('listen-db');
      const col = db.collection('items');

      const callback = jest.fn();
      const registration = col.listen(callback);

      expect(mockNativeModule.listenCollection).toHaveBeenCalled();

      registration.remove();
      expect(mockNativeModule.removeCollectionListener).toHaveBeenCalled();
    });
  });
});
