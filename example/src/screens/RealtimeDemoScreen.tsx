import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import RiviumSync, {
  SyncDocument,
  SyncCollection,
  ListenerRegistration,
} from '@rivium/sync-react-native';
import {AppConfig} from '../config';
import {CodeSnippet} from '../components';

export const RealtimeDemoScreen: React.FC = () => {
  const [collection, setCollection] = useState<SyncCollection | null>(null);
  const [documents, setDocuments] = useState<SyncDocument[]>([]);
  const [watchedDocument, setWatchedDocument] = useState<SyncDocument | null>(
    null,
  );
  const [watchedDocId, setWatchedDocId] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [isListeningCollection, setIsListeningCollection] = useState(false);
  const [isListeningDocument, setIsListeningDocument] = useState(false);

  const collectionListenerRef = useRef<ListenerRegistration | null>(null);
  const documentListenerRef = useRef<ListenerRegistration | null>(null);

  useEffect(() => {
    const db = RiviumSync.database(AppConfig.databaseName);
    const col = db.collection(AppConfig.messagesCollection);
    setCollection(col);

    return () => {
      collectionListenerRef.current?.remove();
      documentListenerRef.current?.remove();
    };
  }, []);

  const addToLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setEventLog(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]);
  };

  const startCollectionListener = () => {
    if (!collection || isListeningCollection) return;

    console.log('[RealtimeDemo] Starting collection listener...');
    collectionListenerRef.current = collection.listen(docs => {
      console.log('[RealtimeDemo] CALLBACK RECEIVED! docs:', docs?.length);
      setDocuments(docs);
      addToLog(`Collection updated: ${docs.length} documents`);
    });

    setIsListeningCollection(true);
    addToLog('Started listening to collection');
    console.log('[RealtimeDemo] Listener started, isListeningCollection set to true');
  };

  const stopCollectionListener = () => {
    collectionListenerRef.current?.remove();
    collectionListenerRef.current = null;
    setIsListeningCollection(false);
    setDocuments([]);
    addToLog('Stopped listening to collection');
  };

  const startDocumentListener = (docId: string) => {
    if (!collection) return;

    documentListenerRef.current?.remove();

    documentListenerRef.current = collection.listenDocument(docId, document => {
      setWatchedDocument(document);
      setWatchedDocId(docId);
      if (document) {
        addToLog(`Document updated: ${JSON.stringify(document.data)}`);
      } else {
        addToLog('Document deleted');
      }
    });

    setIsListeningDocument(true);
    addToLog(`Started listening to document: ${docId}`);
  };

  const stopDocumentListener = () => {
    documentListenerRef.current?.remove();
    documentListenerRef.current = null;
    setIsListeningDocument(false);
    setWatchedDocument(null);
    setWatchedDocId(null);
    addToLog('Stopped listening to document');
  };

  const createTestDocument = async () => {
    if (!collection) return;
    try {
      const doc = await collection.add({
        message: `Hello at ${new Date().toLocaleString()}`,
        sender: 'Test User',
        timestamp: new Date().toISOString(),
      });
      addToLog(`Created document: ${doc.id}`);

      // Auto-start collection listener if not active
      if (!isListeningCollection) {
        startCollectionListener();
      }

      // Auto-start document listener on the newly created doc
      if (!isListeningDocument) {
        startDocumentListener(doc.id);
      }
    } catch (e: any) {
      addToLog(`Error creating: ${e.message}`);
    }
  };

  const updateRandomDocument = async () => {
    if (!collection) return;

    let currentDocs = documents;
    if (currentDocs.length === 0) {
      try {
        currentDocs = await collection.getAll();
      } catch (e) {
        addToLog('No documents to update. Create a document first!');
        return;
      }
    }

    if (currentDocs.length === 0) {
      addToLog('No documents to update. Create a document first!');
      return;
    }

    const doc = currentDocs[0];
    try {
      await collection.update(doc.id, {
        message: `Updated at ${new Date().toLocaleString()}`,
        updatedAt: new Date().toISOString(),
      });
      addToLog(`Updated document: ${doc.id}`);
    } catch (e: any) {
      addToLog(`Error updating: ${e.message}`);
    }
  };

  const deleteRandomDocument = async () => {
    if (!collection) return;

    let currentDocs = documents;
    if (currentDocs.length === 0) {
      try {
        currentDocs = await collection.getAll();
      } catch (e) {
        addToLog('No documents to delete. Create a document first!');
        return;
      }
    }

    if (currentDocs.length === 0) {
      addToLog('No documents to delete. Create a document first!');
      return;
    }

    const doc = currentDocs[currentDocs.length - 1];
    try {
      await collection.delete(doc.id);
      addToLog(`Deleted document: ${doc.id}`);
    } catch (e: any) {
      addToLog(`Error deleting: ${e.message}`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <CodeSnippet
        title="Realtime Listener Example"
        code={`// Listen to collection changes
const listener = collection.listen((documents) => {
  console.log('Collection updated:', documents.length);
});

// Listen to specific document
const docListener = collection.listenDocument(
  'doc-id',
  (document) => {
    if (document) {
      console.log('Document changed:', document.data);
    } else {
      console.log('Document was deleted');
    }
  },
);

// Stop listening
listener.remove();
docListener.remove();`}
      />

      {/* Collection Listener Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text
            style={[
              styles.listenerIcon,
              {color: isListeningCollection ? '#10B981' : '#9CA3AF'},
            ]}>
            {isListeningCollection ? '\u{1F442}' : '\u{1F507}'}
          </Text>
          <Text style={styles.cardTitle}>Collection Listener</Text>
          <Switch
            value={isListeningCollection}
            onValueChange={value => {
              if (value) {
                startCollectionListener();
              } else {
                stopCollectionListener();
              }
            }}
            trackColor={{false: '#D1D5DB', true: '#86EFAC'}}
            thumbColor={isListeningCollection ? '#10B981' : '#F3F4F6'}
          />
        </View>
        {isListeningCollection && documents.length > 0 && (
          <>
            <View style={styles.divider} />
            <Text style={styles.docsCount}>{documents.length} documents</Text>
            <View style={styles.documentsList}>
              {documents.map(item => (
                <View key={item.id} style={styles.documentItem}>
                  <View style={styles.documentContent}>
                    <Text style={styles.documentMessage} numberOfLines={1}>
                      {(item.data.message as string) || 'No message'}
                    </Text>
                    <Text style={styles.documentId}>
                      ID: {item.id.substring(0, 8)}...
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.watchButton}
                    onPress={() => startDocumentListener(item.id)}>
                    <Text style={styles.watchButtonText}>{'\u{1F441}'}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* Document Listener Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text
            style={[
              styles.listenerIcon,
              {color: isListeningDocument ? '#3B82F6' : '#9CA3AF'},
            ]}>
            {isListeningDocument ? '\u{1F441}' : '\u{1F648}'}
          </Text>
          <View style={styles.listenerInfo}>
            <Text style={styles.cardTitle}>Document Listener</Text>
            {watchedDocId && (
              <Text style={styles.watchingText}>
                Watching: {watchedDocId.substring(0, 8)}...
              </Text>
            )}
          </View>
          {isListeningDocument && (
            <TouchableOpacity
              style={styles.stopButton}
              onPress={stopDocumentListener}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </TouchableOpacity>
          )}
        </View>
        {watchedDocument && (
          <>
            <View style={styles.divider} />
            <Text style={styles.dataLabel}>Document Data:</Text>
            <View style={styles.dataBox}>
              <Text style={styles.dataText} selectable>
                {JSON.stringify(watchedDocument.data, null, 2)}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Test Actions Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Test Actions</Text>
        <Text style={styles.subtitle}>
          Trigger changes to see realtime updates
        </Text>
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.createButton]}
            onPress={createTestDocument}>
            <Text style={styles.actionButtonText}>+ Create</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.updateButton]}
            onPress={updateRandomDocument}>
            <Text style={styles.actionButtonText}>{'\u270E'} Update</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={deleteRandomDocument}>
            <Text style={styles.actionButtonText}>{'\u2715'} Delete</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Event Log Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Event Log</Text>
          <TouchableOpacity onPress={() => setEventLog([])}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.divider} />
        {eventLog.length === 0 ? (
          <Text style={styles.emptyText}>
            No events yet. Start a listener and make changes!
          </Text>
        ) : (
          <View style={styles.eventLogContainer}>
            {eventLog.map((event, index) => (
              <Text key={index} style={styles.eventText}>
                {event}
              </Text>
            ))}
          </View>
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
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  listenerIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  listenerInfo: {
    flex: 1,
  },
  watchingText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  stopButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  stopButtonText: {
    fontSize: 12,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  docsCount: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  documentsList: {
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  documentContent: {
    flex: 1,
  },
  documentMessage: {
    fontSize: 14,
    color: '#111827',
  },
  documentId: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  watchButton: {
    padding: 8,
  },
  watchButtonText: {
    fontSize: 16,
  },
  dataLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  dataBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 12,
  },
  dataText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#374151',
  },
  subtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  createButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  updateButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  deleteButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  clearText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '500',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    padding: 20,
  },
  eventLogContainer: {
    maxHeight: 200,
  },
  eventText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#6B7280',
    paddingVertical: 4,
  },
});
