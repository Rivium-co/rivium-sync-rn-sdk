import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import RiviumSync, {SyncDocument, SyncCollection} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {ResultCard, CodeSnippet} from '../components';

export const CrudDemoScreen: React.FC = () => {
  const [collection, setCollection] = useState<SyncCollection | null>(null);
  const [documents, setDocuments] = useState<SyncDocument[]>([]);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const db = RiviumSync.database(AppConfig.databaseName);
    const col = db.collection(AppConfig.todosCollection);
    setCollection(col);
  }, []);

  useEffect(() => {
    if (collection) {
      loadDocuments();
    }
  }, [collection]);

  const loadDocuments = async () => {
    if (!collection) return;
    setIsLoading(true);
    try {
      const docs = await collection.getAll();
      setDocuments(docs);
      setLastResult(`Loaded ${docs.length} documents`);
    } catch (e: any) {
      setLastResult(`Error loading: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const createDocument = async () => {
    if (!collection) return;
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a title');
      return;
    }

    setIsLoading(true);
    try {
      const doc = await collection.add({
        title: title.trim(),
        description: description.trim(),
        completed: false,
        createdAt: new Date().toISOString(),
      });

      setTitle('');
      setDescription('');
      setLastResult(`Created document: ${doc.id}`);
      await loadDocuments();
    } catch (e: any) {
      setLastResult(`Error creating: ${e.message}`);
      Alert.alert('Error', e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const readDocument = async (docId: string) => {
    if (!collection) return;
    setIsLoading(true);
    try {
      const doc = await collection.get(docId);
      if (doc) {
        setLastResult(
          `Read document:\nID: ${doc.id}\nData: ${JSON.stringify(doc.data, null, 2)}\nVersion: ${doc.version}\nCreatedAt: ${doc.createdAt}\nUpdatedAt: ${doc.updatedAt}`,
        );
        setSelectedDocId(docId);
      } else {
        setLastResult('Document not found');
      }
    } catch (e: any) {
      setLastResult(`Error reading: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const updateDocument = async (docId: string) => {
    if (!collection) return;
    setIsLoading(true);
    try {
      const doc = await collection.update(docId, {
        updatedAt: new Date().toISOString(),
        description: `Updated at ${new Date().toLocaleString()}`,
      });
      setLastResult(
        `Updated document: ${doc.id}\nNew version: ${doc.version}`,
      );
      await loadDocuments();
    } catch (e: any) {
      setLastResult(`Error updating: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleComplete = async (docId: string, currentValue: boolean) => {
    if (!collection) return;
    setIsLoading(true);
    try {
      await collection.update(docId, {
        completed: !currentValue,
        completedAt: !currentValue ? new Date().toISOString() : null,
      });
      setLastResult(`Toggled completed: ${!currentValue}`);
      await loadDocuments();
    } catch (e: any) {
      setLastResult(`Error toggling: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDocument = async (docId: string) => {
    Alert.alert('Delete Document', 'Are you sure you want to delete this document?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!collection) return;
          setIsLoading(true);
          try {
            await collection.delete(docId);
            setLastResult(`Deleted document: ${docId}`);
            if (selectedDocId === docId) setSelectedDocId(null);
            await loadDocuments();
          } catch (e: any) {
            setLastResult(`Error deleting: ${e.message}`);
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  const renderDocument = ({item}: {item: SyncDocument}) => {
    const completed = item.data.completed as boolean;
    return (
      <View style={styles.documentItem}>
        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => toggleComplete(item.id, completed)}>
          <Text style={styles.checkboxText}>{completed ? '\u2713' : ''}</Text>
        </TouchableOpacity>
        <View style={styles.documentContent}>
          <Text
            style={[styles.documentTitle, completed && styles.completedText]}>
            {(item.data.title as string) || 'Untitled'}
          </Text>
          <Text style={styles.documentDescription} numberOfLines={1}>
            {(item.data.description as string) || ''}
          </Text>
        </View>
        <View style={styles.documentActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => readDocument(item.id)}>
            <Text style={styles.actionText}>Read</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => updateDocument(item.id)}>
            <Text style={styles.actionText}>Update</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => deleteDocument(item.id)}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CodeSnippet
        title="CRUD Example"
        code={`// Create
const doc = await collection.add({
  title: 'My Task',
  completed: false,
});

// Read
const doc = await collection.get('doc-id');

// Update
await collection.update('doc-id', {
  completed: true,
});

// Delete
await collection.delete('doc-id');`}
      />

      {/* Create Form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create Document</Text>
        <TextInput
          style={styles.input}
          placeholder="Title"
          value={title}
          onChangeText={setTitle}
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={2}
          placeholderTextColor="#9CA3AF"
        />
        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={createDocument}
          disabled={isLoading}>
          <Text style={styles.buttonText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {/* Documents List */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Documents</Text>
          <Text style={styles.countText}>{documents.length} items</Text>
          <TouchableOpacity onPress={loadDocuments}>
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>
        {isLoading && documents.length === 0 ? (
          <ActivityIndicator size="large" color="#10B981" style={styles.loader} />
        ) : documents.length === 0 ? (
          <Text style={styles.emptyText}>
            No documents yet. Create one above!
          </Text>
        ) : (
          <FlatList
            data={documents}
            renderItem={renderDocument}
            keyExtractor={item => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>

      {/* Result Card */}
      {lastResult && (
        <ResultCard title="Last Operation Result" result={lastResult} />
      )}
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
  countText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginRight: 12,
  },
  refreshText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  textArea: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#10B981',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  loader: {
    padding: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    padding: 20,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: 'bold',
  },
  documentContent: {
    flex: 1,
  },
  documentTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  documentDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  documentActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
  },
  actionText: {
    fontSize: 12,
    color: '#6B7280',
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
  },
  deleteText: {
    fontSize: 12,
    color: '#EF4444',
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
});
