import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '../constants/colors';
import { useAppStore } from '../store/appStore';
import { wsClient } from '../services/websocket';

const GOAL_TEMPLATES = [
  { label: 'Book appointment', text: 'Book a massage appointment for Saturday at 3pm' },
  { label: 'Job inquiry', text: 'Find out about job openings and schedule an interview' },
  { label: 'Price negotiation', text: 'Get the best price for the service, max budget $200' },
  { label: 'Reservation', text: 'Make a restaurant reservation for 2 people this Friday at 7pm' },
  { label: 'Support call', text: 'Resolve the issue with my account and get a refund' },
];

export default function GoalSetupScreen() {
  const goal = useAppStore((s) => s.goal);
  const [input, setInput] = useState(goal);

  function save() {
    const g = input.trim();
    useAppStore.getState().setGoal(g);
    wsClient.send({ type: 'set_goal', goal: g });
    router.back();
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>CALL GOAL</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="What do you want to achieve in this call?"
          placeholderTextColor={Colors.textMuted}
          multiline
          autoFocus
        />

        <Text style={styles.templatesLabel}>QUICK TEMPLATES</Text>
        <View style={styles.templates}>
          {GOAL_TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t.label}
              style={styles.templateBtn}
              onPress={() => setInput(t.text)}
            >
              <Text style={styles.templateLabel}>{t.label}</Text>
              <Text style={styles.templateText}>{t.text}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveBtnText}>Set Goal</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 20, gap: 16 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    color: Colors.textPrimary,
    fontSize: 15,
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
    lineHeight: 22,
  },
  templatesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.5,
  },
  templates: { gap: 8 },
  templateBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  templateLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 3,
  },
  templateText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
