import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useAppStore } from '../../store/appStore';

export default function HistoryScreen() {
  const transcript = useAppStore((s) => s.transcript);

  const grouped = transcript.filter((t) => t.isFinal);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {grouped.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No history yet</Text>
            <Text style={styles.emptyText}>
              Transcripts from your calls will appear here.
            </Text>
          </View>
        ) : (
          grouped.map((item) => (
            <View
              key={item.id}
              style={[
                styles.row,
                item.speaker === 'gst' ? styles.rowGST : styles.rowHON,
              ]}
            >
              <Text style={styles.speaker}>
                {item.speaker === 'gst' ? 'Guest' : 'You'}
              </Text>
              <Text style={styles.text}>{item.text}</Text>
              {item.translation ? (
                <Text style={styles.translation}>{item.translation}</Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 8 },
  empty: { flex: 1, alignItems: 'center', marginTop: 80, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.textSecondary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', maxWidth: 260 },
  row: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderLeftWidth: 3,
  },
  rowGST: {
    backgroundColor: Colors.gstBubble,
    borderLeftColor: Colors.gst,
  },
  rowHON: {
    backgroundColor: Colors.honBubble,
    borderLeftColor: Colors.hon,
  },
  speaker: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: 4,
    letterSpacing: 1,
  },
  text: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  translation: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 4,
  },
});
