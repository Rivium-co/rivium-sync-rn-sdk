/**
 * 0.3.0: set() replaces unless { merge: true }, listeners and queries report the security rules' typed errors,
 * and query listeners work on Android.
 */

type Handler = (event: any) => void;
const mockHandlers: Record<string, Handler[]> = {};
const mockPlatform = { OS: 'ios', select: (obj: any) => obj.ios };

const mockNativeModule: Record<string, jest.Mock> = {
  setDocument: jest.fn(),
  executeBatch: jest.fn(),
  queryDocuments: jest.fn(),
  listenQuery: jest.fn(),
  removeQueryListener: jest.fn(),
  listenCollection: jest.fn(),
  removeCollectionListener: jest.fn(),
  listenDocument: jest.fn(),
  removeDocumentListener: jest.fn(),
  waitForQueryUpdate: jest.fn(),
  waitForCollectionUpdate: jest.fn(),
  waitForDocumentUpdate: jest.fn(),
};

jest.mock('react-native', () => ({
  NativeModules: { RiviumSync: mockNativeModule },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (name: string, handler: Handler) => {
      (mockHandlers[name] ??= []).push(handler);
      return {
        remove: () => {
          mockHandlers[name] = mockHandlers[name].filter((h) => h !== handler);
        },
      };
    },
  })),
  Platform: mockPlatform,
  AppState: { addEventListener: jest.fn() },
}));

import { SyncCollection, WriteBatch, RiviumSyncError } from '../index';
import type { SyncDocument } from '../index';

const emit = (name: string, event: any) => (mockHandlers[name] ?? []).forEach((h) => h(event));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const nativeDoc: SyncDocument = {
  id: 'todo-1',
  data: { title: 'Buy milk', completed: false },
  createdAt: 1,
  updatedAt: 2,
  version: 3,
};

/** A native wait that never answers (the listener is idle). */
const pending = () => new Promise(() => {});

describe('security rules v2', () => {
  const todos = new SyncCollection('my-app', 'todos', 'todos');

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
    mockPlatform.OS = 'ios';
    for (const m of Object.values(mockNativeModule)) m.mockResolvedValue(undefined);
  });

  describe('set()', () => {
    it('replaces by default: sends merge false', async () => {
      mockNativeModule.setDocument.mockResolvedValue(nativeDoc);
      const doc = await todos.set('todo-1', { title: 'Buy milk', completed: false });
      expect(mockNativeModule.setDocument).toHaveBeenCalledWith({
        databaseId: 'my-app',
        collectionId: 'todos',
        documentId: 'todo-1',
        data: { title: 'Buy milk', completed: false },
        merge: false,
      });
      // The native document is passed through as is: no extra { data } wrapper.
      expect(doc).toEqual(nativeDoc);
      expect(doc.data.title).toBe('Buy milk');
    });

    it('sends merge true with { merge: true }', async () => {
      await todos.set('todo-1', { completed: true }, { merge: true });
      expect(mockNativeModule.setDocument.mock.calls[0][0].merge).toBe(true);
    });

    it('batch set replaces by default and merges when asked', async () => {
      await new WriteBatch()
        .set(todos, 'a', { x: 1 })
        .set(todos, 'b', { y: 2 }, { merge: true })
        .commit();
      const ops = mockNativeModule.executeBatch.mock.calls[0][0].operations;
      expect(ops[0]).toMatchObject({ type: 'set', documentId: 'a', merge: false });
      expect(ops[1]).toMatchObject({ type: 'set', documentId: 'b', merge: true });
    });
  });

  describe('query get()', () => {
    it('turns query_not_allowed into a RiviumSyncError with fields (Android: userInfo)', async () => {
      mockNativeModule.queryDocuments.mockRejectedValue(
        Object.assign(new Error('Add a filter on teamId'), { code: 'query_not_allowed', userInfo: { fields: ['teamId'] } })
      );
      const error = await todos.where('done', '==', false).get().catch((e) => e);
      expect(error).toBeInstanceOf(RiviumSyncError);
      expect(error.code).toBe(RiviumSyncError.QUERY_NOT_ALLOWED);
      expect(error.message).toBe('Add a filter on teamId');
      expect(error.fields).toEqual(['teamId']);
      expect(error.statusCode).toBe(403);
    });

    it('query_not_allowed without fields has an empty list', async () => {
      mockNativeModule.queryDocuments.mockRejectedValue(Object.assign(new Error('no'), { code: 'query_not_allowed' }));
      const error = await todos.query().get().catch((e) => e);
      expect(error).toBeInstanceOf(RiviumSyncError);
      expect(error.fields).toEqual([]);
    });

    it('passes other errors on unchanged', async () => {
      const offline = Object.assign(new Error('offline'), { code: 'QUERY_ERROR' });
      mockNativeModule.queryDocuments.mockRejectedValue(offline);
      await expect(todos.query().get()).rejects.toBe(offline);
    });

    it('sends filter values with their JSON type', async () => {
      mockNativeModule.queryDocuments.mockResolvedValue([nativeDoc]);
      const docs = await todos.where('count', '==', 5).where('done', '==', false).get();
      expect(mockNativeModule.queryDocuments.mock.calls[0][0].filters).toEqual([
        { field: 'count', operator: '==', value: 5 },
        { field: 'done', operator: '==', value: false },
      ]);
      expect(docs[0].data.title).toBe('Buy milk');
    });
  });

  describe('listeners on iOS (event emitter)', () => {
    it('query listener: documents, then query_not_allowed with fields', () => {
      const docs: SyncDocument[][] = [];
      const errors: RiviumSyncError[] = [];
      todos.where('done', '==', false).listen((d) => docs.push(d), (e) => errors.push(e));
      const { listenerId } = mockNativeModule.listenQuery.mock.calls[0][0];

      emit('queryUpdate', { listenerId, documents: [nativeDoc] });
      emit('queryUpdate', { listenerId: 'someone-else', documents: [] });
      emit('queryUpdate', {
        listenerId,
        error: { code: 'query_not_allowed', message: 'Add a filter on teamId', fields: ['teamId'], statusCode: 403 },
      });
      emit('queryUpdate', { listenerId, documents: [] }); // nothing after an error

      expect(docs).toEqual([[nativeDoc]]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(RiviumSyncError);
      expect(errors[0].code).toBe('query_not_allowed');
      expect(errors[0].fields).toEqual(['teamId']);
      expect(errors[0].statusCode).toBe(403);
    });

    it('collection listener: listener_revoked', () => {
      const errors: RiviumSyncError[] = [];
      todos.listen(() => {}, (e) => errors.push(e));
      const { listenerId } = mockNativeModule.listenCollection.mock.calls[0][0];
      emit('collectionUpdate', { listenerId, error: { code: 'listener_revoked', message: 'stopped' } });
      expect(errors[0].code).toBe(RiviumSyncError.LISTENER_REVOKED);
      expect(errors[0].message).toBe('stopped');
      expect(errors[0].fields).toEqual([]);
    });

    it('document listener: the document, null when deleted, then permission_denied', () => {
      const docs: (SyncDocument | null)[] = [];
      const errors: RiviumSyncError[] = [];
      todos.listenDocument('todo-1', (d) => docs.push(d), (e) => errors.push(e));
      const { listenerId, documentId } = mockNativeModule.listenDocument.mock.calls[0][0];
      expect(documentId).toBe('todo-1');

      emit('documentUpdate', { listenerId, document: nativeDoc });
      emit('documentUpdate', { listenerId, document: null });
      emit('documentUpdate', { listenerId, error: { code: 'permission_denied', message: 'Read permission denied' } });

      expect(docs).toEqual([nativeDoc, null]);
      expect(errors[0].code).toBe(RiviumSyncError.PERMISSION_DENIED);
    });

    it('a listener without onError keeps working and ignores the error', () => {
      const docs: SyncDocument[][] = [];
      todos.listen((d) => docs.push(d));
      const { listenerId } = mockNativeModule.listenCollection.mock.calls[0][0];
      emit('collectionUpdate', { listenerId, documents: [nativeDoc] });
      expect(() => emit('collectionUpdate', { listenerId, error: { code: 'listener_revoked', message: 'x' } })).not.toThrow();
      expect(docs).toEqual([[nativeDoc]]);
    });

    it('remove() stops events and the native listener', () => {
      const docs: SyncDocument[][] = [];
      const reg = todos.query().listen((d) => docs.push(d));
      const { listenerId } = mockNativeModule.listenQuery.mock.calls[0][0];
      reg.remove();
      emit('queryUpdate', { listenerId, documents: [nativeDoc] });
      expect(docs).toEqual([]);
      expect(mockNativeModule.removeQueryListener).toHaveBeenCalledWith({ listenerId });
    });
  });

  describe('listeners on Android (waiting promises)', () => {
    beforeEach(() => {
      mockPlatform.OS = 'android';
    });

    it('query listener delivers results through waitForQueryUpdate', async () => {
      mockNativeModule.waitForQueryUpdate
        .mockResolvedValueOnce({ documents: [nativeDoc] })
        .mockResolvedValueOnce({ documents: [] })
        .mockImplementation(pending);
      const docs: SyncDocument[][] = [];
      const reg = todos
        .where('done', '==', false)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .listen((d) => docs.push(d));
      await flush();

      const started = mockNativeModule.listenQuery.mock.calls[0][0];
      expect(started).toMatchObject({
        databaseId: 'my-app',
        collectionId: 'todos',
        filters: [{ field: 'done', operator: '==', value: false }],
        orderBy: { field: 'createdAt', direction: 'desc' },
        limit: 10,
      });
      expect(mockNativeModule.waitForQueryUpdate).toHaveBeenCalledWith({ listenerId: started.listenerId });
      expect(docs).toEqual([[nativeDoc], []]);
      expect(Object.keys(mockHandlers)).not.toContain('queryUpdate');

      reg.remove();
      expect(mockNativeModule.removeQueryListener).toHaveBeenCalledWith({ listenerId: started.listenerId });
    });

    it('query listener: query_not_allowed ends the listener and stops waiting', async () => {
      mockNativeModule.waitForQueryUpdate
        .mockResolvedValueOnce({
          error: { code: 'query_not_allowed', message: 'Add a filter on teamId', fields: ['teamId'], statusCode: 403 },
        })
        .mockImplementation(pending);
      const docs: SyncDocument[][] = [];
      const errors: RiviumSyncError[] = [];
      todos.query().listen((d) => docs.push(d), (e) => errors.push(e));
      await flush();

      expect(docs).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].fields).toEqual(['teamId']);
      expect(mockNativeModule.waitForQueryUpdate).toHaveBeenCalledTimes(1);
    });

    it('collection listener: documents then listener_revoked', async () => {
      mockNativeModule.waitForCollectionUpdate
        .mockResolvedValueOnce({ documents: [nativeDoc] })
        .mockResolvedValueOnce({ error: { code: 'listener_revoked', message: 'stopped' } })
        .mockImplementation(pending);
      const docs: SyncDocument[][] = [];
      const errors: RiviumSyncError[] = [];
      todos.listen((d) => docs.push(d), (e) => errors.push(e));
      await flush();

      expect(docs).toEqual([[nativeDoc]]);
      expect(errors.map((e) => e.code)).toEqual(['listener_revoked']);
      expect(mockNativeModule.waitForCollectionUpdate).toHaveBeenCalledTimes(2);
    });

    it('document listener: document, deleted, permission_denied', async () => {
      mockNativeModule.waitForDocumentUpdate
        .mockResolvedValueOnce({ document: nativeDoc })
        .mockResolvedValueOnce({ document: null })
        .mockResolvedValueOnce({ error: { code: 'permission_denied', message: 'denied', statusCode: 403 } })
        .mockImplementation(pending);
      const docs: (SyncDocument | null)[] = [];
      const errors: RiviumSyncError[] = [];
      todos.listenDocument('todo-1', (d) => docs.push(d), (e) => errors.push(e));
      await flush();

      expect(docs).toEqual([nativeDoc, null]);
      expect(errors[0].code).toBe('permission_denied');
      expect(errors[0].statusCode).toBe(403);
    });

    it('stops waiting once the native side says the listener was removed', async () => {
      mockNativeModule.waitForQueryUpdate.mockRejectedValue(Object.assign(new Error('gone'), { code: 'LISTENER_REMOVED' }));
      const reg = todos.query().listen(() => {});
      await flush();
      expect(mockNativeModule.waitForQueryUpdate).toHaveBeenCalledTimes(1);
      reg.remove();
    });
  });

  describe('RiviumSyncError', () => {
    it('is an Error with code, message, fields and statusCode', () => {
      const e = RiviumSyncError.fromNative({ code: 'query_not_allowed', message: 'm', fields: ['teamId', 7], statusCode: 403 });
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('RiviumSyncError');
      expect(e.fields).toEqual(['teamId']);
      expect(e.statusCode).toBe(403);
    });

    it('falls back to UNKNOWN_ERROR', () => {
      const e = RiviumSyncError.fromNative(undefined);
      expect(e.code).toBe('UNKNOWN_ERROR');
      expect(e.message).toBe('Unknown error');
    });
  });
});
