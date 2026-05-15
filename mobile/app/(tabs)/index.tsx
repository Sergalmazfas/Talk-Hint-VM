import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAppStore } from '../../store/appStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useMicrophone } from '../../hooks/useMicrophone';
import { TranscriptFeed } from '../../components/TranscriptFeed';
import { HintCard } from '../../components/HintCard';
import { MicButton } from '../../components/MicButton';
import { ConnectionStatus } from '../../components/StatusBar';
import { GoalBanner } from '../../components/GoalBanner';
import { wsClient } from '../../services/websocket';

export default function AssistantScreen() {
  const serverUrl = useAppStore((s) => s.serverUrl);
  const isConnected = useAppStore((s) => s.isConnected);
  const transcript = useAppStore((s) => s.transcript);
  const currentHints = useAppStore((s) => s.currentHints);
  const goal = useAppStore((s) => s.goal);
  const goalState = useAppStore((s) => s.goalState);
  const isGoalAchieved = useAppStore((s) => s.isGoalAchieved);
  const setHints = useAppStore((s) => s.setHints);
  const isMicActive = useAppStore((s) => s.isMicActive);
  const clearSession = useAppStore((s) => s.clearSession);

  const { toggleMic } = useMicrophone();
  useWebSocket();

  const [showGoalInput, setShowGoalInput] = useState(false);
  const [goalInput, setGoalInput] = useState(goal);
  const [askInput, setAskInput] = useState('');

  function saveGoal() {
    const g = goalInput.trim();
    useAppStore.getState().setGoal(g);
    wsClient.send({ type: 'set_goal', goal: g });
    setShowGoalInput(false);
  }

  function askAI() {
    const q = askInput.trim();
    if (!q) return;
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect to TalkHint backend in Settings first.');
      return;
    }
    wsClient.send({ type: 'ask_ai', question: q });
    setAskInput('');
  }

  if (!serverUrl) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.setupPrompt}>
          <Ionicons name="server-outline" size={52} color={Colors.textMuted} />
          <Text style={styles.setupTitle}>Connect to Server</Text>
          <Text style={styles.setupText}>
            Open Settings and enter your TalkHint server URL to get started.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <View style={styles.topBar}>
          <ConnectionStatus
            isConnected={isConnected}
            serverUrl={serverUrl}
            isMicActive={isMicActive}
          />
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => { setGoalInput(goal); setShowGoalInput(true); }}
            >
              <Ionicons name="flag-outline" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={clearSession}>
              <Ionicons name="trash-outline" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {showGoalInput && (
          <View style={styles.goalInputContainer}>
            <Text style={styles.goalInputLabel}>SET CALL GOAL</Text>
            <TextInput
              style={styles.goalInput}
              value={goalInput}
              onChangeText={setGoalInput}
              placeholder="e.g. Book a massage appointment for Saturday 3pm"
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.goalInputBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowGoalInput(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveGoalBtn} onPress={saveGoal}>
                <Text style={styles.saveGoalBtnText}>Set Goal</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <GoalBanner goal={goal} goalState={goalState} isAchieved={isGoalAchieved} />

        <View style={styles.transcriptArea}>
          <TranscriptFeed items={transcript} />
        </View>

        {currentHints.length > 0 && (
          <HintCard hints={currentHints} onDismiss={() => setHints([])} />
        )}

        <View style={styles.bottomBar}>
          <View style={styles.askRow}>
            <TextInput
              style={styles.askInput}
              value={askInput}
              onChangeText={setAskInput}
              placeholder="Ask AI during call..."
              placeholderTextColor={Colors.textMuted}
              returnKeyType="send"
              onSubmitEditing={askAI}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !askInput.trim() && styles.sendBtnDisabled]}
              onPress={askAI}
              disabled={!askInput.trim()}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.micRow}>
            <MicButton
              isActive={isMicActive}
              onPress={toggleMic}
              disabled={!isConnected}
            />
            <Text style={styles.micHint}>
              {isMicActive ? 'Tap to stop' : isConnected ? 'Tap to listen' : 'Connect first'}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topActions: { flexDirection: 'row', gap: 4 },
  iconBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
  },
  goalInputContainer: {
    margin: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  goalInputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  goalInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    padding: 12,
    color: Colors.textPrimary,
    fontSize: 14,
    minHeight: 60,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  goalInputBtns: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelBtnText: { color: Colors.textSecondary, fontSize: 14 },
  saveGoalBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveGoalBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  transcriptArea: {
    flex: 1,
  },
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 12,
    gap: 12,
  },
  askRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  askInput: {
    flex: 1,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  micRow: {
    alignItems: 'center',
    gap: 6,
  },
  micHint: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  setupPrompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 16,
  },
  setupTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  setupText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
