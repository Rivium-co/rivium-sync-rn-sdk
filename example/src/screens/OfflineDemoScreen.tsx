import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import RiviumSync, {SyncState, SyncCollection} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {ResultCard, CodeSnippet} from '../components';

export const OfflineDemoScreen: React.FC = () => {
  const [collection, setCollection] = useState<SyncCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const db = RiviumSync.database(AppConfig.databaseId);
    const col = db.collection(AppConfig.messagesCollection);
    setCollection(col);

    checkStatus();

    // Setup listeners
    const unsubSyncState = RiviumSync.onSyncState(state => {
      setSyncState(state);
    });

    const unsubPendingCount = RiviumSync.onPendingCount(count => {
      setPendingCount(count);
    });

    const unsubConnectionState = RiviumSync.onConnectionState(connected => {
      setIsConnected(connected);
    });

    return () => {
      unsubSyncState();
      unsubPendingCount();
      unsubConnectionState();
    };
  }, []);

  const checkStatus = async () => {
    try {
      const connected = await RiviumSync.isConnected();
      const state = await RiviumSync.getSyncState();
      const pending = await RiviumSync.getPendingCount();

      setIsConnected(connected);
      setSyncState(state);
      setPendingCount(pending);
    } catch (e) {
      // Silently handle - status methods may not be available
    }
  };

  const createDocument = async () => {
    if (!collection) return;
    setIsLoading(true);
    setResult(null);

    try {
      const doc = await collection.add({
        message: `Created at ${new Date().toLocaleString()}`,
        timestamp: new Date().toISOString(),
        isConnected,
      });

      setResult(
        `Document created: ${doc.id}\nConnection: ${isConnected ? 'Online - synced immediately' : 'Offline - queued for sync'}`,
      );
      setIsError(false);
    } catch (e: any) {
      setResult(`Error creating document: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
      await checkStatus();
    }
  };

  const readDocuments = async () => {
    if (!collection) return;
    setIsLoading(true);
    setResult(null);

    try {
      const docs = await collection.getAll();
      const preview = docs
        .slice(0, 3)
        .map(d => `- ${d.id.substring(0, 8)}...: ${d.data.message || 'no message'}`)
        .join('\n');

      setResult(
        `Read ${docs.length} documents:\n${preview}${docs.length > 3 ? `\n... and ${docs.length - 3} more` : ''}`,
      );
      setIsError(false);
    } catch (e: any) {
      setResult(`Error reading documents: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const forceSyncNow = async () => {
    setIsLoading(true);
    setResult(null);

    try {
      await RiviumSync.forceSyncNow();
      setResult('Force sync triggered');
      setIsError(false);
    } catch (e: any) {
      setResult(`Error syncing: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
      await checkStatus();
    }
  };

  const clearLocalCache = async () => {
    setIsLoading(true);
    setResult(null);

    try {
      await RiviumSync.clearOfflineCache();
      setResult('Local cache cleared');
      setIsError(false);
    } catch (e: any) {
      setResult(`Error clearing cache: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
      await checkStatus();
    }
  };

  const syncStateToString = (state: SyncState) => {
    switch (state) {
      case 'idle':
        return 'Idle';
      case 'syncing':
        return 'Syncing...';
      case 'offline':
        return 'Offline';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const getSyncStateColor = () => {
    switch (syncState) {
      case 'idle':
        return '#10B981';
      case 'syncing':
        return '#3B82F6';
      case 'offline':
        return '#F59E0B';
      case 'error':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CodeSnippet
        title="Offline Persistence Example"
        code={`// Enable offline persistence (in initialization)
await RiviumSync.init({
  apiKey: 'your-api-key',
  offlineEnabled: true,
});

// Listen to sync state changes
RiviumSync.onSyncState((state) => {
  console.log('Sync state:', state);
});

// Listen to pending count changes
RiviumSync.onPendingCount((count) => {
  console.log('Pending writes:', count);
});

// Force sync pending writes
await RiviumSync.forceSyncNow();

// Clear local cache
await RiviumSync.clearOfflineCache();`}
      />

      {/* Status Card */}
      <View style={styles.card}>
        <View style={styles.statusHeader}>
          <Text
            style={[
              styles.connectionIcon,
              {color: isConnected ? '#10B981' : '#F59E0B'},
            ]}>
            {isConnected ? '\u2601' : '\u2601'}
          </Text>
          <View style={styles.connectionInfo}>
            <Text style={styles.connectionTitle}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Text>
            <Text style={styles.connectionSubtitle}>
              Sync state: {syncStateToString(syncState)}
            </Text>
          </View>
          <View style={styles.offlineChip}>
            <Text style={styles.offlineChipText}>
              {RiviumSync.isOfflineEnabled ? 'Offline enabled' : 'Online only'}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <Text style={styles.statusIcon}>{'\u23F3'}</Text>
            <Text style={styles.statusValue}>{pendingCount}</Text>
            <Text style={styles.statusLabel}>Pending Writes</Text>
          </View>
          <View style={styles.statusItem}>
            <Text
              style={[
                styles.statusIcon,
                {color: getSyncStateColor()},
              ]}>
              {syncState === 'syncing' ? '\u21BB' : '\u2601'}
            </Text>
            <Text style={styles.statusValue}>{syncStateToString(syncState)}</Text>
            <Text style={styles.statusLabel}>Sync State</Text>
          </View>
        </View>
      </View>

      {/* Actions Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Test Offline Features</Text>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={createDocument}
            disabled={isLoading}>
            <Text style={styles.actionButtonText}>+ Create Document</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={readDocuments}
            disabled={isLoading}>
            <Text style={styles.actionButtonText}>{'\u2630'} Read Documents</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.outlineButton,
              pendingCount === 0 && styles.disabledButton,
            ]}
            onPress={forceSyncNow}
            disabled={isLoading || pendingCount === 0}>
            <Text
              style={[
                styles.outlineButtonText,
                pendingCount === 0 && styles.disabledText,
              ]}>
              {'\u21BB'} Force Sync
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.outlineButton]}
            onPress={clearLocalCache}
            disabled={isLoading}>
            <Text style={styles.outlineButtonText}>{'\u2715'} Clear Cache</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Result */}
      {isLoading ? (
        <View style={styles.loaderCard}>
          <ActivityIndicator size="large" color="#10B981" />
        </View>
      ) : result ? (
        <ResultCard
          title={isError ? 'Error' : 'Result'}
          result={result}
          isError={isError}
        />
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  connectionInfo: {
    flex: 1,
  },
  connectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  connectionSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  offlineChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  offlineChipText: {
    fontSize: 11,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statusItem: {
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 24,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  statusLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#10B981',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  outlineButtonText: {
    color: '#374151',
  },
  disabledButton: {
    borderColor: '#E5E7EB',
  },
  disabledText: {
    color: '#D1D5DB',
  },
  loaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 32,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
});
