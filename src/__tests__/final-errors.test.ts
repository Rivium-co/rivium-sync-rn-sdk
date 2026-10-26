/**
 * 0.3.0: errors the server answered carry its HTTP status (`statusCode`) and are thrown, queued writes the server
 * refused are reported (`onDocumentRejected`), and `emulator` points the SDK at a local server.
 */

type Handler = (event: any) => void;
const mockHandlers: Record<string, Handler[]> = {};

const mockNativeModule: Record<string, jest.Mock> = {
  init: jest.fn(),
  addDocument: jest.fn(),
  getDocument: jest.fn(),
  getAllDocuments: jest.fn(),
  updateDocument: jest.fn(),
  setDocument: jest.fn(),
  deleteDocument: jest.fn(),
  queryDocuments: jest.fn(),
  executeBatch: jest.fn(),
  listCollections: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: { RiviumSync: mockNativeModule },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (name: string, handler: Handler) => {
      (mockHandlers[name] ??= []).push(handler);
      return { remove: jest.fn() };
    },
  })),
  Platform: { OS: 'android', select: (obj: any) => obj.android ?? obj.default },
  AppState: { addEventListener: jest.fn() },
}));

import type * as SyncModule from '../index';

const emit = (name: string, event: any) => (mockHandlers[name] ?? []).forEach((h) => h(event));

/** A fresh copy of the SDK (RiviumSync is a singleton that initialises once). */
function freshSdk(): typeof SyncModule {
  let sdk: typeof SyncModule | undefined;
  jest.isolateModules(() => {
    sdk = require('../index');
  });
  return sdk!;
}

/** A native rejection as React Native delivers it: a code, a message and the native module's userInfo. */
function nativeRejection(code: string, message: string, userInfo?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, userInfo });
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
  for (const m of Object.values(mockNativeModule)) m.mockResolvedValue(undefined);
});

describe('emulator', () => {
  it('passes host and the default port 3006 to the native SDK', async () => {
    const { RiviumSync } = freshSdk();
    await RiviumSync.init({ apiKey: 'rv_live_key', emulator: { host: ' 10.0.2.2 ' } });
    expect(mockNativeModule.init.mock.calls[0][0]).toMatchObject({ emulatorHost: '10.0.2.2', emulatorPort: 3006 });
  });

  it('passes a custom port', async () => {
    const { RiviumSync } = freshSdk();
    await RiviumSync.init({ apiKey: 'rv_live_key', emulator: { host: 'localhost', port: 4000 } });
    expect(mockNativeModule.init.mock.calls[0][0]).toMatchObject({ emulatorHost: 'localhost', emulatorPort: 4000 });
  });

  it("uses Rivium's servers when not set", async () => {
    const { RiviumSync } = freshSdk();
    await RiviumSync.init({ apiKey: 'rv_live_key' });
    expect(mockNativeModule.init.mock.calls[0][0].emulatorHost).toBeUndefined();
    expect(mockNativeModule.init.mock.calls[0][0].emulatorPort).toBeUndefined();
  });

  it.each([
    ['an empty host', { host: '  ' }],
    ['a scheme', { host: 'http://10.0.2.2' }],
    ['a port in the host', { host: 'localhost:3006' }],
    ['port 0', { host: 'localhost', port: 0 }],
    ['port 65536', { host: 'localhost', port: 65536 }],
    ['a fractional port', { host: 'localhost', port: 30.5 }],
  ])('refuses %s before anything starts', async (_label, emulator) => {
    const { RiviumSync } = freshSdk();
    await expect(RiviumSync.init({ apiKey: 'rv_live_key', emulator })).rejects.toThrow(/emulator\./);
    expect(mockNativeModule.init).not.toHaveBeenCalled();
    expect(RiviumSync.isInitialized).toBe(false);
  });
});

describe('errors the server answered', () => {
  const { SyncCollection, WriteBatch, RiviumSyncError } = freshSdk();
  const todos = new SyncCollection('my-app', 'todos', 'todos');

  const calls: [string, string, () => Promise<unknown>][] = [
    ['add()', 'addDocument', () => todos.add({ title: 'x' })],
    ['get()', 'getDocument', () => todos.get('a')],
    ['update()', 'updateDocument', () => todos.update('a', { title: 'x' })],
    ['set()', 'setDocument', () => todos.set('a', { title: 'x' })],
    ['delete()', 'deleteDocument', () => todos.delete('a')],
    ['query get()', 'queryDocuments', () => todos.where('userId', '==', 'u').get()],
  ];

  it.each(calls)('%s rejects with a RiviumSyncError carrying statusCode, keeping the native code', async (_n, method, call) => {
    mockNativeModule[method].mockRejectedValue(
      nativeRejection('DOCUMENT_ERROR', 'Permission denied by security rules', { statusCode: 403 })
    );
    const error: any = await call().catch((e) => e);
    expect(error).toBeInstanceOf(RiviumSyncError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('DOCUMENT_ERROR');
    expect(error.statusCode).toBe(403);
    expect(error.message).toBe('Permission denied by security rules');
    expect(error.userInfo).toEqual({ statusCode: 403 });
  });

  it.each([400, 404, 422])('a %i is thrown, not swallowed', async (status) => {
    mockNativeModule.getDocument.mockRejectedValue(nativeRejection('DOCUMENT_ERROR', 'no', { statusCode: status }));
    await expect(todos.get('a')).rejects.toMatchObject({ statusCode: status });
  });

  it('getAll() the rules do not allow rejects with query_not_allowed and its fields', async () => {
    mockNativeModule.getAllDocuments.mockRejectedValue(
      nativeRejection('query_not_allowed', 'Add a filter on userId', { fields: ['userId'], statusCode: 403 })
    );
    const error = await todos.getAll().catch((e) => e);
    expect(error).toBeInstanceOf(RiviumSyncError);
    expect(error.code).toBe(RiviumSyncError.QUERY_NOT_ALLOWED);
    expect(error.fields).toEqual(['userId']);
    expect(error.statusCode).toBe(403);
  });

  it('a batch the server refused rejects with statusCode and can be retried', async () => {
    mockNativeModule.executeBatch.mockRejectedValueOnce(nativeRejection('BATCH_ERROR', 'refused', { statusCode: 403 }));
    const batch = new WriteBatch().create(todos, { title: 'x' });
    const error = await batch.commit().catch((e) => e);
    expect(error).toBeInstanceOf(RiviumSyncError);
    expect(error.code).toBe('BATCH_ERROR');
    expect(error.statusCode).toBe(403);
    await batch.commit();
    expect(mockNativeModule.executeBatch).toHaveBeenCalledTimes(2);
  });

  it('an error without an answer from the server is passed on unchanged', async () => {
    const offline = nativeRejection('DOCUMENT_ERROR', 'Unable to resolve host');
    mockNativeModule.addDocument.mockRejectedValue(offline);
    await expect(todos.add({ title: 'x' })).rejects.toBe(offline);
  });

  it('results still come back as they are', async () => {
    const doc = { id: 'a', data: { title: 'x' }, createdAt: 1, updatedAt: 2, version: 1 };
    mockNativeModule.getDocument.mockResolvedValue(doc);
    await expect(todos.get('a')).resolves.toEqual(doc);
    mockNativeModule.getDocument.mockResolvedValue(null);
    await expect(todos.get('missing')).resolves.toBeNull();
  });
});

describe('onDocumentRejected', () => {
  it('reports a queued write the server refused, with the operation and statusCode', async () => {
    const { RiviumSync, RiviumSyncError } = freshSdk();
    await RiviumSync.init({ apiKey: 'rv_live_key', offlineEnabled: true });
    const seen: any[] = [];
    const stop = RiviumSync.onDocumentRejected((documentId, operation, error) => seen.push({ documentId, operation, error }));

    emit('onDocumentRejected', {
      documentId: 'doc-1',
      operation: 'create',
      error: { code: 'permission_denied', message: 'Permission denied', statusCode: 403 },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].documentId).toBe('doc-1');
    expect(seen[0].operation).toBe('create');
    expect(seen[0].error).toBeInstanceOf(RiviumSyncError);
    expect(seen[0].error.code).toBe('permission_denied');
    expect(seen[0].error.statusCode).toBe(403);

    stop();
    emit('onDocumentRejected', { documentId: 'doc-2', operation: 'delete', error: { message: 'x' } });
    expect(seen).toHaveLength(1);
  });

  it('reads update and delete, and ignores an event without a document id', async () => {
    const { RiviumSync } = freshSdk();
    await RiviumSync.init({ apiKey: 'rv_live_key', offlineEnabled: true });
    const seen: string[] = [];
    RiviumSync.onDocumentRejected((id, operation, error) => seen.push(`${id}:${operation}:${error.statusCode}`));

    emit('onDocumentRejected', { documentId: 'a', operation: 'update', error: { message: 'bad', statusCode: 422 } });
    emit('onDocumentRejected', { documentId: 'b', operation: 'delete', error: { message: 'gone' } });
    emit('onDocumentRejected', { operation: 'create', error: {} });

    expect(seen).toEqual(['a:update:422', 'b:delete:undefined']);
  });
});
