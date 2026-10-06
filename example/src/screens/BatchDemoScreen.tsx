import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import RiviumSync, {SyncDatabase, SyncCollection} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {ResultCard, CodeSnippet} from '../components';

export const BatchDemoScreen: React.FC = () => {
  const [db, setDb] = useState<SyncDatabase | null>(null);
  const [collection, setCollection] = useState<SyncCollection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [createdDocIds, setCreatedDocIds] = useState<string[]>([]);

  useEffect(() => {
    const database = RiviumSync.database(AppConfig.databaseName);
    const col = database.collection(AppConfig.messagesCollection);
    setDb(database);
    setCollection(col);
  }, []);

  const runBatchCreate = async () => {
    if (!collection) return;
    setIsLoading(true);
    setResult(null);
    setIsError(false);

    try {
      const batch = RiviumSync.batch();
      const docIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        const docId = `batch-doc-${Date.now()}-${i}`;
        docIds.push(docId);
        batch.set(collection, docId, {
          message: `Batch created document ${i}`,
          index: i,
          createdAt: new Date().toISOString(),
          batchId: Date.now().toString(),
        });
      }

      await batch.commit();

      setCreatedDocIds(docIds);
      setResult(
        `Successfully created ${docIds.length} documents:\n${docIds.join('\n')}`,
      );
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const runBatchUpdate = async () => {
    if (!collection) return;
    if (createdDocIds.length === 0) {
      Alert.alert('Info', 'Create batch documents first');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setIsError(false);

    try {
      const batch = RiviumSync.batch();

      for (const docId of createdDocIds) {
        batch.update(collection, docId, {
          updatedAt: new Date().toISOString(),
          status: 'updated',
        });
      }

      await batch.commit();

      setResult(`Successfully updated ${createdDocIds.length} documents`);
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const runBatchDelete = async () => {
    if (!collection) return;
    if (createdDocIds.length === 0) {
      Alert.alert('Info', 'Create batch documents first');
      return;
    }

    setIsLoading(true);
    setResult(null);
    setIsError(false);

    try {
      const batch = RiviumSync.batch();

      for (const docId of createdDocIds) {
        batch.delete(collection, docId);
      }

      await batch.commit();

      setResult(`Successfully deleted ${createdDocIds.length} documents`);
      setCreatedDocIds([]);
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const runMixedBatch = async () => {
    if (!collection) return;
    setIsLoading(true);
    setResult(null);
    setIsError(false);

    try {
      const batch = RiviumSync.batch();
      const timestamp = Date.now();

      // Create 2 new documents
      batch.set(collection, `mixed-create-${timestamp}-1`, {
        message: 'Mixed batch - created 1',
        type: 'created',
        timestamp: new Date().toISOString(),
      });
      batch.set(collection, `mixed-create-${timestamp}-2`, {
        message: 'Mixed batch - created 2',
        type: 'created',
        timestamp: new Date().toISOString(),
      });

      // Update existing documents (if any)
      if (createdDocIds.length > 0) {
        batch.update(collection, createdDocIds[0], {
          mixedBatchUpdate: true,
          updatedAt: new Date().toISOString(),
        });
      }

      await batch.commit();

      setCreatedDocIds([
        `mixed-create-${timestamp}-1`,
        `mixed-create-${timestamp}-2`,
      ]);
      setResult(
        `Mixed batch completed:\n- Created 2 new documents\n- Updated ${createdDocIds.length > 0 ? 1 : 0} existing document(s)\n\nAll operations were atomic - either all succeed or all fail.`,
      );
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CodeSnippet
        title="Batch Write Example"
        code={`// Create a batch
const batch = RiviumSync.batch();

// Add operations
batch.set(collection, 'doc1', {name: 'Alice'});
batch.set(collection, 'doc2', {name: 'Bob'});
batch.update(collection, 'doc3', {status: 'active'});
batch.delete(collection, 'doc4');

// Commit atomically - all succeed or all fail
await batch.commit();`}
      />

      {/* Info Card */}
      <View style={styles.infoCard}>
        <Text style={styles.infoIcon}>{'\u24D8'}</Text>
        <Text style={styles.infoText}>
          Batch operations are atomic - either all operations succeed or all
          fail. This is useful for maintaining data consistency.
        </Text>
      </View>

      {/* Actions Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Batch Actions</Text>
        {createdDocIds.length > 0 && (
          <Text style={styles.trackingText}>
            {createdDocIds.length} documents tracked for update/delete
          </Text>
        )}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={runBatchCreate}
            disabled={isLoading}>
            <Text style={styles.primaryButtonText}>+ Batch Create</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={runBatchUpdate}
            disabled={isLoading}>
            <Text style={styles.secondaryButtonText}>{'\u270E'} Batch Update</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={runBatchDelete}
            disabled={isLoading}>
            <Text style={styles.secondaryButtonText}>{'\u2715'} Batch Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.outlineButton]}
            onPress={runMixedBatch}
            disabled={isLoading}>
            <Text style={styles.outlineButtonText}>{'\u21C4'} Mixed Batch</Text>
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
    marginBottom: 8,
  },
  infoCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoIcon: {
    fontSize: 18,
    color: '#10B981',
    marginRight: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#047857',
    lineHeight: 20,
  },
  trackingText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#10B981',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  secondaryButtonText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '500',
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  outlineButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '500',
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
