import React, {useEffect, useState} from 'react';
import {StatusBar, View, Text, StyleSheet, ActivityIndicator} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import RiviumSync from '@rivium/sync-react-native';
import {AppConfig} from './config';
import {
  HomeScreen,
  CrudDemoScreen,
  RealtimeDemoScreen,
  QueryDemoScreen,
  BatchDemoScreen,
  OfflineDemoScreen,
} from './screens';

export type RootStackParamList = {
  Home: undefined;
  CrudDemo: undefined;
  RealtimeDemo: undefined;
  QueryDemo: undefined;
  BatchDemo: undefined;
  OfflineDemo: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    initializeRiviumSync();
  }, []);

  const initializeRiviumSync = async () => {
    try {
      await RiviumSync.init({
        apiKey: AppConfig.apiKey,
        offlineEnabled: true,
        debugMode: __DEV__, // Enable debug mode in development
      });
      setIsInitialized(true);
    } catch (error: any) {
      setInitError(error.message);
    }
  };

  if (initError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Failed to initialize RiviumSync</Text>
        <Text style={styles.errorDetail}>{initError}</Text>
      </View>
    );
  }

  if (!isInitialized) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Initializing RiviumSync...</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#FFFFFF',
          },
          headerTintColor: '#111827',
          headerTitleStyle: {
            fontWeight: '600',
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: '#F9FAFB',
          },
        }}>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'RiviumSync Example',
          }}
        />
        <Stack.Screen
          name="CrudDemo"
          component={CrudDemoScreen}
          options={{
            title: 'CRUD Operations',
          }}
        />
        <Stack.Screen
          name="RealtimeDemo"
          component={RealtimeDemoScreen}
          options={{
            title: 'Realtime Listeners',
          }}
        />
        <Stack.Screen
          name="QueryDemo"
          component={QueryDemoScreen}
          options={{
            title: 'Query Operations',
          }}
        />
        <Stack.Screen
          name="BatchDemo"
          component={BatchDemoScreen}
          options={{
            title: 'Batch Operations',
          }}
        />
        <Stack.Screen
          name="OfflineDemo"
          component={OfflineDemoScreen}
          options={{
            title: 'Offline Persistence',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#EF4444',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default App;
