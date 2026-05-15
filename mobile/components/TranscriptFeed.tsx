import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ListRenderItem,
} from 'react-native';
import { Colors } from '../constants/colors';
import { TranscriptItem } from '../store/appStore';

interface Props {
  items: TranscriptItem[];
}

export function TranscriptFeed({ items }: Props) {
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (items.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [items.length]);

  const renderItem: ListRenderItem<TranscriptItem> = ({ item }) => {
    const isGST = item.speaker === 'gst';
    return (
      <View style={[styles.bubble, isGST ? styles.gstBubble : styles.honBubble]}>
        <Text style={styles.speakerLabel}>{isGST ? 'GST' : 'HON'}</Text>
        <Text style={[styles.text, isGST ? styles.gstText : styles.honText]}>
          {item.text}
        </Text>
        {item.translation ? (
          <Text style={styles.translation}>{item.translation}</Text>
        ) : null}
      </View>
    );
  };

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Transcript will appear here</Text>
        <Text style={styles.emptySubtext}>Connect to backend and start call</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 12,
    gap: 8,
  },
  bubble: {
    borderRadius: 12,
    padding: 12,
    marginVertical: 3,
    maxWidth: '90%',
  },
  gstBubble: {
    backgroundColor: Colors.gstBubble,
    alignSelf: 'flex-start',
    borderLeftWidth: 2,
    borderLeftColor: Colors.gst,
  },
  honBubble: {
    backgroundColor: Colors.honBubble,
    alignSelf: 'flex-end',
    borderRightWidth: 2,
    borderRightColor: Colors.hon,
  },
  speakerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 4,
    letterSpacing: 1,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  gstText: {
    color: Colors.textPrimary,
  },
  honText: {
    color: '#93c5fd',
  },
  translation: {
    marginTop: 6,
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 6,
  },
  emptySubtext: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
