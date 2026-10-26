import React, {useEffect, useRef, useState} from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform} from 'react-native';
import RiviumSync, {
  ListenerRegistration,
  RiviumSyncError,
  SyncCollection,
} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {currentUserId, mine, otherUserId, switchUser} from '../demoUser';

/** Resolves with the value, or with null after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

/** The error `action` threw, or null when it did not throw. */
async function errorOf(action: () => Promise<unknown>): Promise<any> {
  try {
    await action();
    return null;
  } catch (e) {
    return e;
  }
}

const isQueryNotAllowed = (e: any): e is RiviumSyncError =>
  e instanceof RiviumSyncError && e.code === RiviumSyncError.QUERY_NOT_ALLOWED;

/**
 * Checks for the default "owner only" Security Rules (each document's `userId`
 * must be the signed-in user): what the server refuses, and that the SDK
 * reports it instead of hiding it in the offline cache. Each button prints
 * PASS or FAIL with what it expected.
 */
export const RulesDemoScreen: React.FC = () => {
  const [user, setUser] = useState(currentUserId());
  const [lines, setLines] = useState<string[]>([]);
  const collectionRef = useRef<SyncCollection | null>(null);
  const documentListener = useRef<ListenerRegistration | null>(null);
  const queryListener = useRef<ListenerRegistration | null>(null);
  const rejected = useRef<((documentId: string) => void) | null>(null);

  useEffect(() => {
    collectionRef.current = RiviumSync.database(AppConfig.databaseName).collection(AppConfig.todosCollection);
    const stopRejections = RiviumSync.onDocumentRejected((documentId, operation, error) => {
      log(`Sync: server refused queued ${operation} of ${documentId} (${error.statusCode}): ${error.message}`);
      rejected.current?.(documentId);
    });
    return () => {
      stopRejections();
      documentListener.current?.remove();
      queryListener.current?.remove();
    };
  }, []);

  const log = (line: string) => {
    const time = new Date().toLocaleTimeString('en-US', {hour12: false});
    setLines(prev => [...prev, `[${time}] ${line}`]);
  };

  const check = (passed: boolean, expected: string, got: string) => {
    log(passed ? `✓ PASS: ${expected}` : `✗ FAIL: expected ${expected}; got ${got}`);
  };

  const run = async (label: string, action: (collection: SyncCollection) => Promise<void> | void) => {
    const collection = collectionRef.current;
    if (!collection) return;
    log(`— ${label}`);
    try {
      await action(collection);
    } catch (e: any) {
      log(`✗ FAIL: unexpected ${e?.name ?? 'error'}: ${e?.message}`);
    }
  };

  // ==================== Checks ====================

  const refusedWrite = async (collection: SyncCollection) => {
    const pendingBefore = await RiviumSync.getPendingCount();
    const error = await errorOf(() => collection.add({title: 'Not mine', userId: otherUserId()}));
    const status = error instanceof RiviumSyncError ? error.statusCode : undefined;
    const pendingAfter = await RiviumSync.getPendingCount();
    check(
      status === 403 && pendingAfter === pendingBefore,
      '403 and nothing queued',
      `status=${status}, queued ${pendingAfter - pendingBefore}, ${error?.message}`,
    );
  };

  const refusedList = async (collection: SyncCollection) => {
    const error = await errorOf(() => collection.getAll());
    check(
      isQueryNotAllowed(error) && error.fields.includes('userId'),
      'query_not_allowed naming userId (not the cache)',
      error ? `${error.code}: ${error.message} fields=${JSON.stringify(error.fields)}` : 'no error: the list came back',
    );
  };

  const otherUsersTodos = async (collection: SyncCollection) => {
    const error = await errorOf(() => collection.where('userId', '==', otherUserId()).get());
    check(
      isQueryNotAllowed(error),
      'query_not_allowed',
      error ? `${error.code}: ${error.message}` : "no error: another user's todos came back",
    );
  };

  const typedEquality = async (collection: SyncCollection) => {
    await collection.add({title: 'Typed', userId: currentUserId(), completed: false});
    const asText = (await mine(collection).where('completed', '==', 'false').get()).length;
    const asBoolean = (await mine(collection).where('completed', '==', false).get()).length;
    check(
      asText === 0 && asBoolean >= 1,
      '"false" finds 0, false finds 1+',
      `"false" found ${asText}, false found ${asBoolean}`,
    );
  };

  const profileId = () => `profile_${currentUserId()}`;

  const setAndMerge = async (collection: SyncCollection) => {
    const id = profileId();
    await collection.set(id, {userId: currentUserId(), a: 1, b: 2});
    await collection.set(id, {userId: currentUserId(), a: 9});
    const replaced = (await collection.get(id))?.data;
    await collection.set(id, {c: 3}, {merge: true});
    const merged = (await collection.get(id))?.data;
    log(`after set: ${JSON.stringify(replaced)}`);
    log(`after merge: ${JSON.stringify(merged)}`);
    check(
      replaced !== undefined &&
        !('b' in replaced) &&
        merged?.c !== undefined &&
        merged?.a !== undefined &&
        merged?.userId === currentUserId(),
      'set drops b; merge keeps a + userId and adds c',
      `set=${JSON.stringify(replaced)}, merge=${JSON.stringify(merged)}`,
    );
  };

  const listenDocument = async (collection: SyncCollection) => {
    documentListener.current?.remove();
    const id = profileId();
    const tick = Date.now();
    let heard: () => void = () => {};
    const heardTick = new Promise<boolean>(resolve => {
      heard = () => resolve(true);
    });
    await collection.set(id, {userId: currentUserId()}, {merge: true});
    documentListener.current = collection.listenDocument(
      id,
      doc => {
        log(`listenDocument: ${JSON.stringify(doc?.data)}`);
        if (doc?.data?.tick === tick) heard();
      },
      e => log(`listenDocument stopped: ${e.code}: ${e.message}`),
    );
    await collection.set(id, {tick}, {merge: true});
    const ok = (await withTimeout(heardTick, 10_000)) === true;
    check(ok, `the listener hears tick=${tick}`, 'nothing heard in 10 s');
  };

  const batchAllOrNothing = async (collection: SyncCollection) => {
    const before = (await mine(collection).get()).length;
    const error = await errorOf(() =>
      RiviumSync.batch()
        .create(collection, {title: 'Batch ok', userId: currentUserId()})
        .create(collection, {title: 'Batch not mine', userId: otherUserId()})
        .commit(),
    );
    const after = (await mine(collection).get()).length;
    check(
      error !== null && after === before,
      'refused, and the allowed create is not saved either',
      `error=${error?.message}, my todos ${before} → ${after}`,
    );
  };

  const offlineRefusedWrite = async (collection: SyncCollection) => {
    const rejection = new Promise<string>(resolve => {
      rejected.current = resolve;
    });
    await RiviumSync.disconnect();
    const queued = await collection.add({title: 'Queued, not mine', userId: otherUserId()});
    log(`Offline: queued ${queued.id}; reconnecting`);
    await RiviumSync.connect();
    const id = await withTimeout(rejection, 15_000);
    rejected.current = null;
    const stillPending = await RiviumSync.getPendingCount();
    check(
      id === queued.id && stillPending === 0,
      'rejected and removed from the queue',
      `rejected=${id}, still pending=${stillPending}`,
    );
  };

  const listenMine = (collection: SyncCollection) => {
    queryListener.current?.remove();
    queryListener.current = mine(collection).listen(
      docs => log(`listen: ${docs.length} todos`),
      e => log(`listen stopped: ${e.code}: ${e.message}`),
    );
    log(
      'Listening. In the Console, publish rules that deny reading todos: expect "listen stopped: listener_revoked". Publish the old rules again after.',
    );
  };

  const onSwitchUser = async () => {
    await switchUser();
    setUser(currentUserId());
    log(`Signed in as ${currentUserId()} (checks 1-3 now use the other user)`);
  };

  const buttons: [string, () => void][] = [
    ["1. Write with another user's id → 403, not queued", () => run('1. Refused write', refusedWrite)],
    ['2. List with no filter → query_not_allowed', () => run('2. Unfiltered list', refusedList)],
    ["3. Another user's todos → refused", () => run("3. Another user's todos", otherUsersTodos)],
    ['4. Typed equality: "false" ≠ false', () => run('4. Typed equality', typedEquality)],
    ['5. set replaces, set merge keeps', () => run('5. set / merge', setAndMerge)],
    ['6. Listen to one document', () => run('6. Listen to one document', listenDocument)],
    ['7. Batch is all or nothing', () => run('7. Batch', batchAllOrNothing)],
    ['8. Offline write the rules refuse is rolled back', () => run('8. Offline refused write', offlineRefusedWrite)],
    ['9. Listen to my todos (then change rules in Console)', () => run('9. Listen to my todos', listenMine)],
    ['Switch user', () => run('Switch user', onSwitchUser)],
    ['Clear log', () => setLines([])],
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.user}>Signed in as {user}</Text>
      {buttons.map(([label, onPress]) => (
        <TouchableOpacity key={label} style={styles.button} onPress={onPress} activeOpacity={0.7}>
          <Text style={styles.buttonText}>{label}</Text>
        </TouchableOpacity>
      ))}
      <View style={styles.log}>
        <Text selectable style={styles.logText}>
          {lines.join('\n')}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  user: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  log: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
  },
  logText: {
    fontFamily: Platform.select({ios: 'Courier', default: 'monospace'}),
    fontSize: 12,
    color: '#111827',
  },
});
