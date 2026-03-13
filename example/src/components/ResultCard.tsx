import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';

interface ResultCardProps {
  title: string;
  result: string;
  isError?: boolean;
}

export const ResultCard: React.FC<ResultCardProps> = ({
  title,
  result,
  isError = false,
}) => {
  const copyToClipboard = () => {
    Alert.alert('Info', 'Text is selectable - long press to copy');
  };

  return (
    <View style={[styles.container, isError && styles.errorContainer]}>
      <View style={styles.header}>
        <Text style={[styles.icon, isError && styles.errorIcon]}>
          {isError ? '!' : '\u2713'}
        </Text>
        <Text style={[styles.title, isError && styles.errorTitle]}>{title}</Text>
        <TouchableOpacity onPress={copyToClipboard} style={styles.copyButton}>
          <Text style={styles.copyText}>Copy</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.resultBox, isError && styles.errorResultBox]}>
        <Text
          style={[styles.resultText, isError && styles.errorResultText]}
          selectable>
          {result}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#10B981',
    marginRight: 8,
    width: 20,
    textAlign: 'center',
  },
  errorIcon: {
    color: '#EF4444',
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  errorTitle: {
    color: '#991B1B',
  },
  copyButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  copyText: {
    fontSize: 12,
    color: '#6B7280',
  },
  resultBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
  },
  errorResultBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#374151',
    lineHeight: 18,
  },
  errorResultText: {
    color: '#991B1B',
  },
});
