import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';

interface CodeSnippetProps {
  title: string;
  code: string;
  initiallyExpanded?: boolean;
}

export const CodeSnippet: React.FC<CodeSnippetProps> = ({
  title,
  code,
  initiallyExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);

  const copyToClipboard = () => {
    Alert.alert('Info', 'Code is selectable - long press to copy');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setIsExpanded(!isExpanded)}
        activeOpacity={0.7}>
        <Text style={styles.codeIcon}>{'{}'}</Text>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity
          onPress={copyToClipboard}
          style={styles.copyButton}
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <Text style={styles.copyText}>Copy</Text>
        </TouchableOpacity>
        <Text style={styles.chevron}>{isExpanded ? '\u25B2' : '\u25BC'}</Text>
      </TouchableOpacity>
      {isExpanded && (
        <View style={styles.codeContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.codeText} selectable>
              {code}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(243, 244, 246, 0.5)',
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  codeIcon: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#10B981',
    marginRight: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  copyText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  chevron: {
    fontSize: 10,
    color: '#9CA3AF',
    marginLeft: 8,
  },
  codeContainer: {
    backgroundColor: '#1E1E1E',
    margin: 12,
    marginTop: 0,
    borderRadius: 8,
    padding: 12,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#D4D4D4',
    lineHeight: 20,
  },
});
