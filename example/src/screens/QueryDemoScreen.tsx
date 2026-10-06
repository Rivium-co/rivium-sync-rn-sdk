import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import RiviumSync, {SyncDocument, SyncCollection} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {ResultCard, CodeSnippet} from '../components';

export const QueryDemoScreen: React.FC = () => {
  const [collection, setCollection] = useState<SyncCollection | null>(null);
  const [results, setResults] = useState<SyncDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = RiviumSync.database(AppConfig.databaseName);
    const col = db.collection(AppConfig.messagesCollection);
    setCollection(col);
  }, []);

  const executeQuery = async (
    queryName: string,
    queryFn: () => Promise<SyncDocument[]>,
  ) => {
    setIsLoading(true);
    setError(null);
    setLastQuery(queryName);

    try {
      const docs = await queryFn();
      setResults(docs);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const queryAll = async () => {
    if (!collection) return;
    await executeQuery('Get All Documents', () => collection.getAll());
  };

  const queryWhereEquals = async () => {
    if (!collection) return;
    await executeQuery('Where sender == "Test User"', () =>
      collection.where('sender', '==', 'Test User').get(),
    );
  };

  const queryOrderBy = async () => {
    if (!collection) return;
    await executeQuery('Order by timestamp (desc)', () =>
      collection.query().orderBy('timestamp', 'desc').get(),
    );
  };

  const queryLimit = async () => {
    if (!collection) return;
    await executeQuery('Limit to 5 documents', () =>
      collection.query().limit(5).get(),
    );
  };

  const queryCompound = async () => {
    if (!collection) return;
    await executeQuery('Compound query (where + orderBy + limit)', () =>
      collection
        .where('sender', '==', 'Test User')
        .orderBy('timestamp', 'desc')
        .limit(3)
        .get(),
    );
  };

  const createSampleData = async () => {
    if (!collection) return;
    setIsLoading(true);

    try {
      const senders = ['Alice', 'Bob', 'Test User', 'Charlie'];
      const messages = [
        'Hello everyone!',
        'How are you?',
        'Great to see you!',
        'This is a test message',
        'RiviumSync is awesome!',
      ];

      for (let i = 0; i < 10; i++) {
        const hoursAgo = new Date();
        hoursAgo.setHours(hoursAgo.getHours() - i);

        await collection.add({
          message: messages[i % messages.length],
          sender: senders[i % senders.length],
          timestamp: hoursAgo.toISOString(),
          priority: i % 3,
        });
      }

      Alert.alert('Success', 'Created 10 sample documents');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderResult = ({item}: {item: SyncDocument}) => (
    <View style={styles.resultItem}>
      <View style={styles.resultContent}>
        <Text style={styles.resultMessage} numberOfLines={1}>
          {(item.data.message as string) || 'No message'}
        </Text>
        <Text style={styles.resultMeta}>
          sender: {item.data.sender as string} | ID: {item.id.substring(0, 8)}
          ...
        </Text>
      </View>
      {item.data.priority !== undefined && (
        <View style={styles.priorityBadge}>
          <Text style={styles.priorityText}>{item.data.priority as number}</Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CodeSnippet
        title="Query Examples"
        code={`// Get all documents
const docs = await collection.getAll();

// Where clause
const filtered = await collection
    .where('sender', '==', 'Alice')
    .get();

// Order by
const sorted = await collection.query()
    .orderBy('timestamp', 'desc')
    .get();

// Limit results
const limited = await collection.query().limit(5).get();

// Compound query
const results = await collection
    .where('status', '==', 'active')
    .orderBy('timestamp', 'desc')
    .limit(10)
    .get();`}
      />

      {/* Query Buttons */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Query Actions</Text>
          <TouchableOpacity
            onPress={createSampleData}
            disabled={isLoading}
            style={styles.sampleButton}>
            <Text style={styles.sampleButtonText}>+ Sample Data</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.queryButtons}>
          <TouchableOpacity
            style={styles.queryButton}
            onPress={queryAll}
            disabled={isLoading}>
            <Text style={styles.queryButtonIcon}>{'\u2630'}</Text>
            <Text style={styles.queryButtonText}>Get All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queryButton}
            onPress={queryWhereEquals}
            disabled={isLoading}>
            <Text style={styles.queryButtonIcon}>{'\u2315'}</Text>
            <Text style={styles.queryButtonText}>Where</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queryButton}
            onPress={queryOrderBy}
            disabled={isLoading}>
            <Text style={styles.queryButtonIcon}>{'\u21C5'}</Text>
            <Text style={styles.queryButtonText}>Order By</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queryButton}
            onPress={queryLimit}
            disabled={isLoading}>
            <Text style={styles.queryButtonIcon}>{'\u0023'}</Text>
            <Text style={styles.queryButtonText}>Limit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.queryButton}
            onPress={queryCompound}
            disabled={isLoading}>
            <Text style={styles.queryButtonIcon}>{'\u2A2F'}</Text>
            <Text style={styles.queryButtonText}>Compound</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Results */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Results</Text>
          {lastQuery && (
            <View style={styles.queryChip}>
              <Text style={styles.queryChipText} numberOfLines={1}>
                {lastQuery}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.divider} />
        {isLoading ? (
          <ActivityIndicator
            size="large"
            color="#10B981"
            style={styles.loader}
          />
        ) : error ? (
          <ResultCard title="Error" result={error} isError />
        ) : results.length === 0 ? (
          <Text style={styles.emptyText}>
            No results. Run a query to see results here.
          </Text>
        ) : (
          <>
            <Text style={styles.resultsCount}>
              {results.length} documents found
            </Text>
            <FlatList
              data={results}
              renderItem={renderResult}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </>
        )}
      </View>
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  sampleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  sampleButtonText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '500',
  },
  queryButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  queryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    gap: 6,
  },
  queryButtonIcon: {
    fontSize: 14,
    color: '#10B981',
  },
  queryButtonText: {
    fontSize: 13,
    color: '#10B981',
    fontWeight: '500',
  },
  queryChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 200,
  },
  queryChipText: {
    fontSize: 11,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 12,
  },
  loader: {
    padding: 32,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    padding: 32,
  },
  resultsCount: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  resultContent: {
    flex: 1,
  },
  resultMessage: {
    fontSize: 14,
    color: '#111827',
  },
  resultMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  priorityBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#374151',
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
});
