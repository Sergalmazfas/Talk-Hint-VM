import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { HintItem } from '../store/appStore';

interface Props {
  hints: HintItem[];
  onDismiss?: () => void;
}

export function HintCard({ hints, onDismiss }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (hints.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, friction: 8, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [hints.length, hints[0]?.id]);

  if (hints.length === 0) return null;

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.header}>
        <View style={styles.dot} />
        <Text style={styles.headerText}>TALKHINT SUGGESTION</Text>
        {onDismiss && (
          <TouchableOpacity onPress={onDismiss} style={styles.dismissBtn}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      {hints.map((hint) => (
        <View key={hint.id} style={styles.hintRow}>
          <Text style={styles.hintEn}>{hint.en}</Text>
          <Text style={styles.hintTranslation}>{hint.translation}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.hintCard,
    borderWidth: 1,
    borderColor: Colors.hintBorder,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  headerText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.success,
    letterSpacing: 1.5,
  },
  dismissBtn: {
    padding: 4,
  },
  dismissText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  hintRow: {
    marginBottom: 8,
  },
  hintEn: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.hintText,
    lineHeight: 22,
  },
  hintTranslation: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
