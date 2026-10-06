import { NativeModules, NativeEventEmitter, Platform, EmitterSubscription, AppState } from 'react-native';

const LINKING_ERROR =
  `The package '@rivium/sync-react-native' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go (Expo managed workflow)\n';

const RiviumSyncModule = NativeModules.RiviumSync
  ? NativeModules.RiviumSync
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

// NativeEventEmitter for iOS (works reliably)
// On Android, we use Promise-based callbacks instead
const eventEmitter = new NativeEventEmitter(RiviumSyncModule);

// Types
export type ConflictStrategy = 'serverWins' | 'clientWins' | 'merge' | 'manual';
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface RiviumSyncConfig {
  /** Your RiviumSync API key from AuthLeap Console (rv_live_xxx or rv_test_xxx) */
  apiKey: string;
  /** Optional user/device identifier for Security Rules (used as auth.uid).
   *  If not provided, the native SDK auto-generates a stable device ID. */
  userId?: string;
  /**
   * A signed user token minted by YOUR backend, which holds the server secret
   * (`POST /users/token`). This is what makes `auth.uid` in Security Rules
   * trustworthy - unlike `userId`, a client cannot forge it.
   *
   * Tokens are short lived (an hour by default). Call
   * `RiviumSync.setUserToken()` with a fresh one whenever you refresh.
   */
  userToken?: string;
  /**
   * Lets the SDK get the user token by itself: at `init`, again shortly before
   * the token expires, and when the app returns to the foreground with an
   * expired one. Return null when no one is signed in, and call
   * `RiviumSync.refreshUserToken()` when the user signs in or out. Preferred
   * over `userToken`. It is the same Rivium user token Rivium Push and Chat use.
   */
  tokenProvider?: RiviumSyncTokenProvider;
  /** Enable debug logging */
  debugMode?: boolean;
  /** Auto reconnect on connection loss (default: true) */
  autoReconnect?: boolean;
  // Offline persistence options
  /** Enable offline persistence (default: false) */
  offlineEnabled?: boolean;
  /** Maximum cache size in MB (default: 100) */
  offlineCacheSizeMb?: number;
  /** Sync pending changes on reconnect (default: true) */
  syncOnReconnect?: boolean;
  /** Conflict resolution strategy (default: 'serverWins') */
  conflictStrategy?: ConflictStrategy;
  /** Maximum sync retry attempts (default: 3) */
  maxSyncRetries?: number;
}

export interface SyncDocument {
  id: string;
  data: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionInfo {
  id: string;
  name: string;
  databaseId: string;
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

export type QueryOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'array-contains'
  | 'in'
  | 'not-in';

export type OrderDirection = 'asc' | 'desc';

export interface QueryFilter {
  field: string;
  operator: QueryOperator;
  value: any;
}

// Listener registration
export interface ListenerRegistration {
  remove: () => void;
}

// Query builder class
export class SyncQuery {
  private databaseId: string;
  private collectionId: string;
  private filters: QueryFilter[] = [];
  private orderByField?: string;
  private orderDirection: OrderDirection = 'asc';
  private limitCount?: number;
  private offsetCount?: number;

  constructor(databaseId: string, collectionId: string) {
    this.databaseId = databaseId;
    this.collectionId = collectionId;
  }

  where(field: string, operator: QueryOperator, value: any): SyncQuery {
    this.filters.push({ field, operator, value });
    return this;
  }

  orderBy(field: string, direction: OrderDirection = 'asc'): SyncQuery {
    this.orderByField = field;
    this.orderDirection = direction;
    return this;
  }

  limit(count: number): SyncQuery {
    this.limitCount = count;
    return this;
  }

  offset(count: number): SyncQuery {
    this.offsetCount = count;
    return this;
  }

  async get(): Promise<SyncDocument[]> {
    return RiviumSyncModule.queryDocuments({
      databaseId: this.databaseId,
      collectionId: this.collectionId,
      filters: this.filters,
      orderBy: this.orderByField
        ? { field: this.orderByField, direction: this.orderDirection }
        : undefined,
      limit: this.limitCount,
      offset: this.offsetCount,
    });
  }

  listen(callback: (documents: SyncDocument[]) => void): ListenerRegistration {
    const listenerId = `query_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    let subscription: EmitterSubscription | null = null;

    // Set up event listener for iOS
    if (Platform.OS === 'ios') {
      subscription = eventEmitter.addListener('queryUpdate', (event: any) => {
        if (event.listenerId === listenerId) {
          callback(event.documents);
        }
      });
    }

    // Start native listener
    RiviumSyncModule.listenQuery({
      databaseId: this.databaseId,
      collectionId: this.collectionId,
      filters: this.filters,
      orderBy: this.orderByField
        ? { field: this.orderByField, direction: this.orderDirection }
        : undefined,
      limit: this.limitCount,
      offset: this.offsetCount,
      listenerId,
    });

    // TODO: Add Android callback-based approach for query listeners if needed

    return {
      remove: () => {
        subscription?.remove();
        RiviumSyncModule.removeQueryListener({ listenerId });
      },
    };
  }
}

// Collection class
export class SyncCollection {
  public readonly databaseId: string;
  public readonly id: string;
  public readonly name: string;

  constructor(databaseId: string, id: string, name: string) {
    this.databaseId = databaseId;
    this.id = id;
    this.name = name;
  }

  async add(data: Record<string, any>): Promise<SyncDocument> {
    return RiviumSyncModule.addDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      data,
    });
  }

  async get(documentId: string): Promise<SyncDocument | null> {
    return RiviumSyncModule.getDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      documentId,
    });
  }

  async getAll(): Promise<SyncDocument[]> {
    return RiviumSyncModule.getAllDocuments({
      databaseId: this.databaseId,
      collectionId: this.id,
    });
  }

  async update(
    documentId: string,
    data: Record<string, any>
  ): Promise<SyncDocument> {
    return RiviumSyncModule.updateDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      documentId,
      data,
    });
  }

  async set(
    documentId: string,
    data: Record<string, any>
  ): Promise<SyncDocument> {
    return RiviumSyncModule.setDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      documentId,
      data,
    });
  }

  async delete(documentId: string): Promise<void> {
    return RiviumSyncModule.deleteDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      documentId,
    });
  }

  query(): SyncQuery {
    return new SyncQuery(this.databaseId, this.id);
  }

  where(field: string, operator: QueryOperator, value: any): SyncQuery {
    return this.query().where(field, operator, value);
  }

  listen(callback: (documents: SyncDocument[]) => void): ListenerRegistration {
    const listenerId = `collection_${this.id}_${Date.now()}`;
    let isActive = true;
    let subscription: EmitterSubscription | null = null;

    // Start native listener
    RiviumSyncModule.listenCollection({
      databaseId: this.databaseId,
      collectionId: this.id,
      listenerId,
    });

    if (Platform.OS === 'android') {
      // On Android, use Promise-based callback approach (event emitter is unreliable)
      const waitForUpdates = async () => {
        while (isActive) {
          try {
            const result = await RiviumSyncModule.waitForCollectionUpdate({ listenerId });
            if (isActive && result?.documents) {
              callback(result.documents);
            }
          } catch (e: any) {
            // Listener was removed - exit loop
            if (e?.code === 'LISTENER_REMOVED' || !isActive) {
              break;
            }
            // Brief delay before retry on unexpected error
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      };
      waitForUpdates();
    } else {
      // On iOS, use NativeEventEmitter (works reliably)
      subscription = eventEmitter.addListener('collectionUpdate', (event) => {
        if (event?.listenerId === listenerId) {
          callback(event.documents);
        }
      });
    }

    return {
      remove: () => {
        isActive = false;
        subscription?.remove();
        RiviumSyncModule.removeCollectionListener({ listenerId });
      },
    };
  }

  listenDocument(
    documentId: string,
    callback: (document: SyncDocument | null) => void
  ): ListenerRegistration {
    const listenerId = `doc_${this.id}_${documentId}_${Date.now()}`;
    let isActive = true;
    let subscription: EmitterSubscription | null = null;

    // Start native listener
    RiviumSyncModule.listenDocument({
      databaseId: this.databaseId,
      collectionId: this.id,
      documentId,
      listenerId,
    });

    if (Platform.OS === 'android') {
      // On Android, use Promise-based callback approach
      const waitForUpdates = async () => {
        while (isActive) {
          try {
            const result = await RiviumSyncModule.waitForDocumentUpdate({ listenerId });
            if (isActive) {
              callback(result?.document ?? null);
            }
          } catch (e: any) {
            if (e?.code === 'LISTENER_REMOVED' || !isActive) {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      };
      waitForUpdates();
    } else {
      // On iOS, use NativeEventEmitter
      subscription = eventEmitter.addListener('documentUpdate', (event) => {
        if (event?.listenerId === listenerId) {
          callback(event.document);
        }
      });
    }

    return {
      remove: () => {
        isActive = false;
        subscription?.remove();
        RiviumSyncModule.removeDocumentListener({ listenerId });
      },
    };
  }
}

// Database class
export class SyncDatabase {
  public readonly id: string;
  public readonly name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  /**
   * Get a collection reference.
   *
   * @param collectionName The collection NAME as shown in Rivium Console
   *   (e.g. `'todos'`), not its UUID. Realtime updates are published by name,
   *   so `listen` callbacks only receive changes when you pass the name.
   */
  collection(collectionName: string): SyncCollection {
    return new SyncCollection(this.id, collectionName, collectionName);
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return RiviumSyncModule.listCollections({ databaseId: this.id });
  }

  async createCollection(name: string): Promise<SyncCollection> {
    const info = await RiviumSyncModule.createCollection({
      databaseId: this.id,
      name,
    });
    // Keyed by name, like collection(): realtime topics carry names, so a
    // UUID-keyed collection would never receive live updates.
    return new SyncCollection(this.id, info.name, info.name);
  }

  async deleteCollection(collectionId: string): Promise<void> {
    return RiviumSyncModule.deleteCollection({ collectionId });
  }
}

// Batch operation type
interface BatchOperation {
  type: 'set' | 'update' | 'delete' | 'create';
  databaseId: string;
  collectionId: string;
  documentId?: string;
  data?: Record<string, any>;
}

/**
 * A write batch is used to perform multiple writes as a single atomic unit.
 *
 * A WriteBatch object can be acquired by calling `RiviumSync.batch()`. It provides
 * methods for adding writes to the batch. None of the writes will be committed
 * (or visible locally) until `commit()` is called.
 *
 * Unlike transactions, write batches are persisted offline and therefore are
 * preferable when you don't need to condition your writes on read data.
 *
 * @example
 * ```typescript
 * const batch = RiviumSync.batch();
 *
 * // Set a document
 * batch.set(usersCollection, 'user1', { name: 'John', age: 30 });
 *
 * // Update a document
 * batch.update(usersCollection, 'user2', { status: 'active' });
 *
 * // Delete a document
 * batch.delete(usersCollection, 'user3');
 *
 * // Commit the batch
 * await batch.commit();
 * ```
 */
export class WriteBatch {
  private operations: BatchOperation[] = [];
  private committed = false;

  /**
   * Writes to the document referred to by the provided collection and document ID.
   * If the document does not exist yet, it will be created.
   * If the document exists, its contents will be overwritten.
   *
   * @param collection - The collection containing the document
   * @param documentId - The ID of the document to write
   * @param data - The data to write to the document
   * @returns This WriteBatch instance for chaining
   */
  set(collection: SyncCollection, documentId: string, data: Record<string, any>): WriteBatch {
    this.checkNotCommitted();
    this.operations.push({
      type: 'set',
      databaseId: collection.databaseId,
      collectionId: collection.id,
      documentId,
      data,
    });
    return this;
  }

  /**
   * Updates fields in the document referred to by the provided collection and document ID.
   * The document must exist. Fields not specified in the update are not modified.
   *
   * @param collection - The collection containing the document
   * @param documentId - The ID of the document to update
   * @param data - The fields to update
   * @returns This WriteBatch instance for chaining
   */
  update(collection: SyncCollection, documentId: string, data: Record<string, any>): WriteBatch {
    this.checkNotCommitted();
    this.operations.push({
      type: 'update',
      databaseId: collection.databaseId,
      collectionId: collection.id,
      documentId,
      data,
    });
    return this;
  }

  /**
   * Deletes the document referred to by the provided collection and document ID.
   *
   * @param collection - The collection containing the document
   * @param documentId - The ID of the document to delete
   * @returns This WriteBatch instance for chaining
   */
  delete(collection: SyncCollection, documentId: string): WriteBatch {
    this.checkNotCommitted();
    this.operations.push({
      type: 'delete',
      databaseId: collection.databaseId,
      collectionId: collection.id,
      documentId,
    });
    return this;
  }

  /**
   * Creates a new document with an auto-generated ID in the specified collection.
   *
   * @param collection - The collection to create the document in
   * @param data - The data for the new document
   * @returns This WriteBatch instance for chaining
   */
  create(collection: SyncCollection, data: Record<string, any>): WriteBatch {
    this.checkNotCommitted();
    this.operations.push({
      type: 'create',
      databaseId: collection.databaseId,
      collectionId: collection.id,
      data,
    });
    return this;
  }

  /**
   * Commits all of the writes in this write batch as a single atomic unit.
   *
   * @throws Error if the batch commit fails or if the batch has already been committed
   */
  async commit(): Promise<void> {
    this.checkNotCommitted();
    this.committed = true;

    if (this.operations.length === 0) {
      return;
    }

    try {
      await RiviumSyncModule.executeBatch({ operations: this.operations });
    } catch (error) {
      this.committed = false; // Allow retry
      throw error;
    }
  }

  /**
   * Returns the number of operations in this batch
   */
  get size(): number {
    return this.operations.length;
  }

  /**
   * Returns true if this batch has no operations
   */
  get isEmpty(): boolean {
    return this.operations.length === 0;
  }

  private checkNotCommitted(): void {
    if (this.committed) {
      throw new Error('WriteBatch has already been committed');
    }
  }
}

/** Returns the signed user token for whoever is signed in, or null. */
export type RiviumSyncTokenProvider = () => string | null | Promise<string | null>;

/** Ask the provider for a new token this long before the old one expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Wait this long before asking again after the provider failed. */
const TOKEN_RETRY_DELAY_MS = 60_000;

/** `exp` of a JWT in milliseconds, or null when it cannot be read. */
function tokenExpiryMs(jwt: string): number | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    // Not every React Native runtime has atob; decode base64url by hand.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0;
    let buffer = 0;
    let json = '';
    for (const ch of part.replace(/=+$/, '')) {
      const value = alphabet.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
      if (value < 0) return null;
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        json += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// Main RiviumSync class
class RiviumSyncClass {
  private _initialized = false;
  private _offlineEnabled = false;
  private connectionListeners: ((connected: boolean) => void)[] = [];
  private errorListeners: ((error: any) => void)[] = [];
  private syncStateListeners: ((state: SyncState) => void)[] = [];
  private pendingCountListeners: ((count: number) => void)[] = [];
  private awaitingUserTokenListeners: (() => void)[] = [];
  private tokenProvider: RiviumSyncTokenProvider | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenExpiresAtMs: number | null = null;
  private watchingAppState = false;

  async init(config: RiviumSyncConfig): Promise<void> {
    if (this._initialized) return;

    this._offlineEnabled = config.offlineEnabled ?? false;

    this.tokenProvider = config.tokenProvider ?? this.tokenProvider;
    let userToken = config.userToken;
    if (this.tokenProvider) {
      try {
        userToken = (await this.tokenProvider()) ?? userToken;
      } catch {
        // Start without a token; refreshUserToken() or the next renewal fixes it.
      }
    }

    await RiviumSyncModule.init({
      apiKey: config.apiKey,
      userId: config.userId,
      userToken,
      debugMode: config.debugMode ?? false,
      autoReconnect: config.autoReconnect ?? true,
      // Offline options
      offlineEnabled: config.offlineEnabled ?? false,
      offlineCacheSizeMb: config.offlineCacheSizeMb ?? 100,
      syncOnReconnect: config.syncOnReconnect ?? true,
      conflictStrategy: config.conflictStrategy ?? 'serverWins',
      maxSyncRetries: config.maxSyncRetries ?? 3,
    });

    // Set up event listeners (these work on iOS, Android uses polling for connection state)
    eventEmitter.addListener('onConnectionState', (connected: boolean) => {
      this.connectionListeners.forEach((cb) => cb(connected));
    });

    eventEmitter.addListener('onError', (error: any) => {
      this.errorListeners.forEach((cb) => cb(error));
    });

    eventEmitter.addListener('onSyncState', (state: SyncState) => {
      this.syncStateListeners.forEach((cb) => cb(state));
    });

    eventEmitter.addListener('onPendingCount', (count: number) => {
      this.pendingCountListeners.forEach((cb) => cb(count));
    });

    eventEmitter.addListener('onAwaitingUserToken', () => {
      this.awaitingUserTokenListeners.forEach((cb) => cb());
    });

    this._initialized = true;
    this.trackToken(userToken ?? null);
  }

  /** Remember when the token expires and, with a provider, plan its renewal. */
  private trackToken(token: string | null): void {
    this.tokenExpiresAtMs = token ? tokenExpiryMs(token) : null;
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    this.tokenRefreshTimer = null;
    if (!this.tokenProvider) return;
    this.watchAppState();
    // No token (signed out) or an unreadable one: nothing to renew until the
    // app calls refreshUserToken().
    if (this.tokenExpiresAtMs == null) return;
    this.scheduleTokenRefresh(Math.max(0, this.tokenExpiresAtMs - TOKEN_REFRESH_MARGIN_MS - Date.now()));
  }

  private scheduleTokenRefresh(waitMs: number): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    this.tokenRefreshTimer = setTimeout(() => {
      this.refreshUserToken().catch(() => {});
    }, waitMs);
  }

  /** Timers do not run while the app is suspended; check once on return. */
  private watchAppState(): void {
    if (this.watchingAppState) return;
    this.watchingAppState = true;
    AppState?.addEventListener?.('change', (state) => {
      if (state !== 'active' || this.tokenExpiresAtMs == null) return;
      if (Date.now() > this.tokenExpiresAtMs - TOKEN_REFRESH_MARGIN_MS) {
        this.refreshUserToken().catch(() => {});
      }
    });
  }


  get isInitialized(): boolean {
    return this._initialized;
  }

  get isOfflineEnabled(): boolean {
    return this._offlineEnabled;
  }

  onConnectionState(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.push(callback);

    // Immediately check current connection state and call callback
    RiviumSyncModule.isConnected().then((connected: boolean) => {
      callback(connected);
    }).catch(() => {});

    // Poll connection state as backup (event emitter may have timing issues)
    let lastState: boolean | null = null;
    const pollInterval = setInterval(async () => {
      try {
        const connected = await RiviumSyncModule.isConnected();
        if (connected !== lastState) {
          lastState = connected;
          callback(connected);
        }
      } catch (e) {
        // Ignore
      }
    }, 500);

    return () => {
      clearInterval(pollInterval);
      const index = this.connectionListeners.indexOf(callback);
      if (index > -1) this.connectionListeners.splice(index, 1);
    };
  }

  onError(callback: (error: any) => void): () => void {
    this.errorListeners.push(callback);
    return () => {
      const index = this.errorListeners.indexOf(callback);
      if (index > -1) this.errorListeners.splice(index, 1);
    };
  }

  // ==================== Offline API ====================

  /**
   * Register a callback for sync state changes
   */
  onSyncState(callback: (state: SyncState) => void): () => void {
    this.syncStateListeners.push(callback);

    // Get initial state immediately
    this.getSyncState().then(state => callback(state)).catch(() => {});

    // On Android, poll sync state since event emitter may be unreliable
    let lastState: SyncState | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    if (Platform.OS === 'android') {
      pollInterval = setInterval(async () => {
        try {
          const state = await this.getSyncState();
          if (state !== lastState) {
            lastState = state;
            callback(state);
          }
        } catch (e) {
          // Ignore
        }
      }, 300);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      const index = this.syncStateListeners.indexOf(callback);
      if (index > -1) this.syncStateListeners.splice(index, 1);
    };
  }

  /**
   * Register a callback for pending operations count changes
   */
  onPendingCount(callback: (count: number) => void): () => void {
    this.pendingCountListeners.push(callback);

    // Get initial count immediately
    this.getPendingCount().then(count => callback(count)).catch(() => {});

    // On Android, poll pending count since event emitter may be unreliable
    let lastCount: number | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    if (Platform.OS === 'android') {
      pollInterval = setInterval(async () => {
        try {
          const count = await this.getPendingCount();
          if (count !== lastCount) {
            lastCount = count;
            callback(count);
          }
        } catch (e) {
          // Ignore
        }
      }, 300);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      const index = this.pendingCountListeners.indexOf(callback);
      if (index > -1) this.pendingCountListeners.splice(index, 1);
    };
  }

  /**
   * Get the current sync state
   */
  async getSyncState(): Promise<SyncState> {
    if (!this._offlineEnabled) return 'idle';
    return RiviumSyncModule.getSyncState();
  }

  /**
   * Get the count of pending operations waiting to be synced
   */
  async getPendingCount(): Promise<number> {
    if (!this._offlineEnabled) return 0;
    return RiviumSyncModule.getPendingCount();
  }

  /**
   * Force sync all pending operations now
   */
  async forceSyncNow(): Promise<void> {
    if (!this._offlineEnabled) return;
    return RiviumSyncModule.forceSyncNow();
  }

  /**
   * Clear all offline cached data
   */
  async clearOfflineCache(): Promise<void> {
    if (!this._offlineEnabled) return;
    return RiviumSyncModule.clearOfflineCache();
  }

  // ==================== Core API ====================

  /**
   * Replace the signed user token the SDK sends with every request.
   *
   * Your backend mints it with its server secret (`POST /users/token`); the app
   * never holds that secret. Call this when the user signs in, and again
   * whenever you refresh the token - they are short lived, an hour by default.
   *
   * ```ts
   * const { token } = await myBackend.fetchRiviumSyncToken();
   * await sync.setUserToken(token);
   * ```
   *
   * If `connect()` was waiting for a token, the SDK connects now; if it is
   * connected as another user, it reconnects as this one.
   *
   * Pass null to stop sending a token, for example when the user signs out.
   */
  async setUserToken(token: string | null): Promise<void> {
    await RiviumSyncModule.setUserToken(token);
    this.trackToken(token);
  }

  /** Set or remove the token provider after `init`. It is asked straight away. */
  async setTokenProvider(provider: RiviumSyncTokenProvider | null): Promise<void> {
    this.tokenProvider = provider;
    if (!provider) {
      if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
      return;
    }
    if (this._initialized) await this.refreshUserToken();
  }

  /**
   * Ask the token provider again and hand the result to the SDK. Call this
   * when the user signs in or out. Does nothing without a provider.
   */
  async refreshUserToken(): Promise<void> {
    if (!this.tokenProvider || !this._initialized) return;
    let token: string | null;
    try {
      token = await this.tokenProvider();
    } catch {
      // Keep the token the SDK has; it may still be valid. Try again later.
      this.scheduleTokenRefresh(TOKEN_RETRY_DELAY_MS);
      return;
    }
    await this.setUserToken(token);
  }

  /**
   * Called when `connect()` starts waiting for a user token: the project
   * requires signed user tokens and none has been supplied yet. Returns a
   * function that removes the listener.
   */
  onAwaitingUserToken(callback: () => void): () => void {
    this.awaitingUserTokenListeners.push(callback);
    return () => {
      this.awaitingUserTokenListeners = this.awaitingUserTokenListeners.filter((cb) => cb !== callback);
    };
  }

  /** True while `connect()` is waiting for a user token. */
  async isAwaitingUserToken(): Promise<boolean> {
    return RiviumSyncModule.isAwaitingUserToken();
  }

  /**
   * Connect to the realtime service. May be called before anyone is signed
   * in: if the project requires signed user tokens and there is none yet, this
   * resolves normally and the SDK connects once a token is set.
   */
  async connect(): Promise<void> {
    return RiviumSyncModule.connect();
  }

  async disconnect(): Promise<void> {
    return RiviumSyncModule.disconnect();
  }

  async isConnected(): Promise<boolean> {
    return RiviumSyncModule.isConnected();
  }

  /**
   * Get a database reference.
   *
   * @param databaseName The database NAME as shown in Rivium Console
   *   (e.g. `'my-app'`), not its UUID. Realtime updates are published by name,
   *   so `listen` callbacks only receive changes when you pass the name.
   *
   * @example
   * ```typescript
   * const todos = RiviumSync.database('my-app').collection('todos');
   * ```
   */
  database(databaseName: string): SyncDatabase {
    if (!this._initialized) {
      throw new Error('RiviumSync not initialized. Call RiviumSync.init() first.');
    }
    return new SyncDatabase(databaseName, '');
  }

  async listDatabases(): Promise<DatabaseInfo[]> {
    return RiviumSyncModule.listDatabases();
  }

  // ==================== Batch Operations ====================

  /**
   * Create a new WriteBatch for atomic operations.
   *
   * A WriteBatch is used to perform multiple writes as a single atomic unit.
   * None of the writes will be committed until `commit()` is called.
   *
   * @example
   * ```typescript
   * const batch = RiviumSync.batch();
   * batch.set(usersCollection, 'user1', { name: 'John' });
   * batch.update(ordersCollection, 'order1', { status: 'shipped' });
   * batch.delete(tempCollection, 'temp1');
   * await batch.commit();
   * ```
   *
   * @returns A new WriteBatch instance
   */
  batch(): WriteBatch {
    if (!this._initialized) {
      throw new Error('RiviumSync not initialized. Call RiviumSync.init() first.');
    }
    return new WriteBatch();
  }

}

export const RiviumSync = new RiviumSyncClass();
export default RiviumSync;
