import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import RiviumSync, {SyncState} from '@rivium/sync-react-native';
import {RootStackParamList} from '../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface DemoCardProps {
  icon: string;
  title: string;
  description: string;
  color: string;
  onPress: () => void;
}

const DemoCard: React.FC<DemoCardProps> = ({
  icon,
  title,
  description,
  color,
  onPress,
}) => (
  <TouchableOpacity
    style={styles.demoCard}
    onPress={onPress}
    activeOpacity={0.7}>
    <View style={[styles.demoIconContainer, {backgroundColor: `${color}15`}]}>
      <Text style={[styles.demoIcon, {color}]}>{icon}</Text>
    </View>
    <View style={styles.demoContent}>
      <Text style={styles.demoTitle}>{title}</Text>
      <Text style={styles.demoDescription}>{description}</Text>
    </View>
    <Text style={styles.chevron}>{'\u203A'}</Text>
  </TouchableOpacity>
);

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    // Setup listeners
    const unsubConnection = RiviumSync.onConnectionState(connected => {
      setIsConnected(connected);
    });

    const unsubSyncState = RiviumSync.onSyncState(state => {
      setSyncState(state);
    });

    const unsubPendingCount = RiviumSync.onPendingCount(count => {
      setPendingCount(count);
    });

    // Check initial connection and auto-connect
    checkConnection();
    autoConnect();

    return () => {
      unsubConnection();
      unsubSyncState();
      unsubPendingCount();
    };
  }, []);

  const checkConnection = async () => {
    try {
      const connected = await RiviumSync.isConnected();
      setIsConnected(connected);
    } catch (e) {
      // Silently handle
    }
  };

  const autoConnect = async () => {
    try {
      const connected = await RiviumSync.isConnected();
      if (!connected) {
        await RiviumSync.connect();
        // After connect succeeds, update UI state directly
        // This ensures UI updates even if the event was missed
        setIsConnected(true);
      }
    } catch (e) {
      // Silently fail auto-connect
    }
  };

  const toggleConnection = async () => {
    setIsConnecting(true);
    try {
      if (isConnected) {
        await RiviumSync.disconnect();
        setIsConnected(false);
      } else {
        await RiviumSync.connect();
        setIsConnected(true);
      }
    } catch (e) {
      // Handle error silently
    } finally {
      setIsConnecting(false);
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
      {/* Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.headerIconContainer}>
          <Text style={styles.headerIcon}>{'\u2601'}</Text>
        </View>
        <Text style={styles.headerTitle}>RiviumSync SDK</Text>
        <Text style={styles.headerVersion}>Version 1.0.0</Text>
        <Text style={styles.headerDescription}>
          A Firebase-like realtime database for instant data synchronization
        </Text>
      </View>

      {/* Connection Card */}
      <View style={styles.card}>
        <View style={styles.connectionRow}>
          <Text
            style={[
              styles.connectionIcon,
              {color: isConnected ? '#10B981' : '#6B7280'},
            ]}>
            {isConnected ? '\u2601' : '\u2601'}
          </Text>
          <View style={styles.connectionInfo}>
            <Text style={styles.connectionTitle}>Realtime Connection</Text>
            <Text style={styles.connectionSubtitle}>
              {isConnected ? 'Connected to RiviumSync server' : 'Not connected'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.connectionButton,
              isConnected && styles.connectionButtonActive,
            ]}
            onPress={toggleConnection}
            disabled={isConnecting}>
            {isConnecting ? (
              <ActivityIndicator size="small" color="#10B981" />
            ) : (
              <Text style={styles.connectionButtonText}>
                {isConnected ? 'Disconnect' : 'Connect'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Sync Status Card */}
      {RiviumSync.isOfflineEnabled && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sync Status</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: `${getSyncStateColor()}15`,
                  borderColor: `${getSyncStateColor()}50`,
                },
              ]}>
              <Text style={[styles.statusLabel, {color: getSyncStateColor()}]}>
                State:{' '}
              </Text>
              <Text style={[styles.statusValue, {color: getSyncStateColor()}]}>
                {syncState.toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor:
                    pendingCount > 0
                      ? 'rgba(245, 158, 11, 0.1)'
                      : 'rgba(16, 185, 129, 0.1)',
                  borderColor:
                    pendingCount > 0
                      ? 'rgba(245, 158, 11, 0.5)'
                      : 'rgba(16, 185, 129, 0.5)',
                },
              ]}>
              <Text
                style={[
                  styles.statusLabel,
                  {color: pendingCount > 0 ? '#F59E0B' : '#10B981'},
                ]}>
                Pending:{' '}
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  {color: pendingCount > 0 ? '#F59E0B' : '#10B981'},
                ]}>
                {pendingCount}
              </Text>
            </View>
          </View>
          {pendingCount > 0 && (
            <TouchableOpacity
              style={styles.syncButton}
              onPress={() => RiviumSync.forceSyncNow()}>
              <Text style={styles.syncButtonText}>Force Sync Now</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Demo Features */}
      <Text style={styles.sectionTitle}>Demo Features</Text>

      <DemoCard
        icon={'\u270E'}
        title="CRUD Operations"
        description="Create, Read, Update, Delete documents"
        color="#3B82F6"
        onPress={() => navigation.navigate('CrudDemo')}
      />

      <DemoCard
        icon={'\u21BB'}
        title="Realtime Listeners"
        description="Listen to document and collection changes"
        color="#10B981"
        onPress={() => navigation.navigate('RealtimeDemo')}
      />

      <DemoCard
        icon={'\u2315'}
        title="Query Operations"
        description="Filter, sort, and paginate data"
        color="#8B5CF6"
        onPress={() => navigation.navigate('QueryDemo')}
      />

      <DemoCard
        icon={'\u2630'}
        title="Batch Operations"
        description="Atomic multi-document writes"
        color="#F59E0B"
        onPress={() => navigation.navigate('BatchDemo')}
      />

      <DemoCard
        icon={'\u2708'}
        title="Offline Persistence"
        description="Work offline with automatic sync"
        color="#14B8A6"
        onPress={() => navigation.navigate('OfflineDemo')}
      />
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
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  headerIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerIcon: {
    fontSize: 40,
    color: '#10B981',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  headerVersion: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  headerDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
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
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connectionIcon: {
    fontSize: 24,
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
  connectionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    minWidth: 100,
    alignItems: 'center',
  },
  connectionButtonActive: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
  },
  connectionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#10B981',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statusChip: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  statusValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  syncButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  syncButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#10B981',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    marginTop: 8,
  },
  demoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  demoIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  demoIcon: {
    fontSize: 24,
  },
  demoContent: {
    flex: 1,
  },
  demoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  demoDescription: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  chevron: {
    fontSize: 24,
    color: '#9CA3AF',
    marginLeft: 8,
  },
});
