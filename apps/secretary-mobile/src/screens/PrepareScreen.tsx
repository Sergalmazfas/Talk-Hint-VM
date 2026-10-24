import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, isLiveMode } from '../api';
import type { Card, SecretaryTask } from '../types';
import { taskStorage } from '../storage';
import { Body, Button, ErrorNotice, Field, Heading, Label, Pill, Row, ScrollPage, Surface } from '../components';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation';

export function PrepareScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [instruction, setInstruction] = useState('');
  const [loadingCards, setLoadingCards] = useState(true);
  const [working, setWorking] = useState(false);
  const [chatWorking, setChatWorking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'you' | 'secretary'; text: string }>>([]);
  const [proposedGoal, setProposedGoal] = useState('');
  const [preparationModel, setPreparationModel] = useState('');
  const recordingRef = useRef(false);
  const requestId = useRef(Crypto.randomUUID());
  const conversationId = useRef(Crypto.randomUUID());
  const pendingMessage = useRef<{ id: string; text: string } | null>(null);

  const saveDraft = useCallback((messages = chatMessages, goal = proposedGoal, model = preparationModel,
    pending = pendingMessage.current) => taskStorage.set({
    clientRequestId: requestId.current,
    conversationId: conversationId.current,
    recipient, phoneNumber: phone, instruction, cardIds: selected,
    chatMessages: messages, proposedGoal: goal, preparationModel: model, pendingMessage: pending,
  }), [chatMessages, proposedGoal, preparationModel, recipient, phone, instruction, selected]);

  useEffect(() => {
    const background = AppState.addEventListener('change', state => {
      if (state !== 'active' && recordingRef.current) {
        recordingRef.current = false;
        setRecording(false);
        void recorder.stop().finally(() =>
          setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
        ).catch(() => undefined);
        setChatError('Microphone stopped when the app left the foreground. Nothing was sent; tap again to record.');
      }
    });
    void taskStorage.get<{
      id?: string; clientRequestId?: string; conversationId?: string; recipient?: string; phoneNumber?: string;
      instruction?: string; cardIds?: string[]; chatMessages?: Array<{ role: 'you' | 'secretary'; text: string }>;
      proposedGoal?: string; preparationModel?: string; pendingMessage?: { id: string; text: string } | null;
    }>()
      .then(saved => {
        if (!saved) return;
        if (!saved.id) {
          if (saved.clientRequestId) requestId.current = saved.clientRequestId;
          if (saved.conversationId) conversationId.current = saved.conversationId;
          if (saved.recipient) setRecipient(saved.recipient);
          if (saved.phoneNumber) setPhone(saved.phoneNumber);
          if (saved.instruction) setInstruction(saved.instruction);
          if (saved.cardIds) setSelected(saved.cardIds);
          if (saved.chatMessages) setChatMessages(saved.chatMessages);
          if (saved.proposedGoal) setProposedGoal(saved.proposedGoal);
          if (saved.preparationModel) setPreparationModel(saved.preparationModel);
          if (saved.pendingMessage) {
            pendingMessage.current = saved.pendingMessage;
            setChatText(saved.pendingMessage.text);
          }
        }
      }).catch(() => undefined);
    void api.cards().then(r => setCards(r.cards)).catch(e => setError(e instanceof Error ? e.message : 'Could not load cards.'))
      .finally(() => setLoadingCards(false));
    return () => {
      background.remove();
      if (recordingRef.current) {
        void recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      }
    };
  }, []);
  const sendChatMessage = async (untrimmedText: string) => {
    const text = untrimmedText.trim();
    if (!text || chatWorking) return;
    const messageId = pendingMessage.current?.text === text ? pendingMessage.current.id : Crypto.randomUUID();
    pendingMessage.current = { id: messageId, text };
    setChatWorking(true);
    setChatError('');
    try {
      await saveDraft(chatMessages, proposedGoal, preparationModel, pendingMessage.current);
      const result = await api.prepareMessage({
        conversationId: conversationId.current, clientMessageId: messageId, text,
      });
      const messages = [...chatMessages, { role: 'you' as const, text }, { role: 'secretary' as const, text: result.reply }];
      setChatMessages(messages);
      setProposedGoal(result.proposedGoal);
      setPreparationModel(result.model);
      pendingMessage.current = null;
      setChatText(current => current === text ? '' : current);
      await saveDraft(messages, result.proposedGoal, result.model, null);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Clarification is unavailable. No alternate model was used.');
    } finally { setChatWorking(false); }
  };
  const resetConversation = async () => {
    setChatWorking(true); setChatError('');
    try {
      await api.resetPreparation(conversationId.current);
      conversationId.current = Crypto.randomUUID();
      pendingMessage.current = null;
      setChatText('');
      setChatMessages([]);
      setProposedGoal('');
      setPreparationModel('');
      await saveDraft([], '', '', null);
    } catch (e) { setChatError(e instanceof Error ? e.message : 'Could not reset the clarification conversation.'); }
    finally { setChatWorking(false); }
  };
  const useSuggestedGoal = async () => {
    setInstruction(proposedGoal);
    await taskStorage.set({
      clientRequestId: requestId.current, conversationId: conversationId.current,
      recipient, phoneNumber: phone, instruction: proposedGoal, cardIds: selected,
      chatMessages, proposedGoal, preparationModel, pendingMessage: null,
    });
  };
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const startVoice = async () => {
    setChatError('');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission was not granted. You can still type the instruction.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
    } catch (e) {
      recordingRef.current = false; setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      setChatError(e instanceof Error ? e.message : 'Microphone recording is unavailable.');
    }
  };
  const stopVoice = async () => {
    let captureUri: string | null = null;
    try {
      await recorder.stop();
      recordingRef.current = false;
      setRecording(false);
      const uri = recorder.uri;
      captureUri = uri;
      if (!uri) throw new Error('No recording was created. Please type your instruction instead.');
      let audio: string, mimeType = 'audio/m4a';
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        mimeType = blob.type.includes('mp4') ? 'audio/mp4' : 'audio/webm';
        audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      setWorking(true);
      const result = await api.transcribe(audio, mimeType);
      if (!result.text.trim()) throw new Error('The transcription service returned no text. Type your question instead.');
      await sendChatMessage(result.text.trim());
    } catch (e) { setChatError(e instanceof Error ? e.message : 'Voice transcription is unavailable.'); }
    finally {
      recordingRef.current = false; setRecording(false);
      if (captureUri && Platform.OS !== 'web') await FileSystem.deleteAsync(captureUri, { idempotent: true }).catch(() => undefined);
      if (captureUri && Platform.OS === 'web') URL.revokeObjectURL(captureUri);
      setWorking(false);
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch { /* release audio route */ }
    }
  };
  const prepare = async () => {
    if (!recipient.trim() || !phone.trim() || !instruction.trim()) {
      setError('Add the recipient, phone number, and a clear instruction before preparing the review.');
      return;
    }
    setWorking(true); setError('');
    try {
      await taskStorage.set({ clientRequestId: requestId.current, conversationId: conversationId.current,
        recipient: recipient.trim(), phoneNumber: phone.trim(), instruction: instruction.trim(), cardIds: selected,
        chatMessages, proposedGoal, preparationModel, status: 'preparing' });
      const result = await api.prepare({ clientRequestId: requestId.current, recipient: recipient.trim(), phoneNumber: phone.trim(),
        instruction: instruction.trim(), cardIds: selected });
      const preparedTask: SecretaryTask = {
        id: result.id, status: result.status, testOnly: result.testOnly, review: result.review, expiresAt: result.expiresAt,
      };
      await taskStorage.set({ id: result.id, clientRequestId: requestId.current, status: result.status,
        expiresAt: result.expiresAt, task: preparedTask });
      nav.replace('TaskDetail', { taskId: result.id, initialTask: preparedTask });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare task.'); }
    finally { setWorking(false); }
  };

  return <ScrollPage>
    <Heading eyebrow="Test task · Step 1 of 2">Write the brief</Heading>
    <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}>
      <Row><Pill tone={isLiveMode() ? 'blue' : 'amber'}>{isLiveMode() ? 'CALL REVIEW' : 'TEST ONLY'}</Pill><Text style={{ color: colors.amber, fontWeight: '800' }}>{isLiveMode() ? 'Nothing is dialed until you confirm' : 'No phone call will be placed'}</Text></Row>
      <Body style={{ color: '#755320' }}>{isLiveMode() ? 'This prepares a real call for review. The number is dialed only after your explicit confirmation on the next screen.' : 'This creates a reviewable test task. Nothing is sent until you confirm on the next screen.'}</Body>
    </Surface>
    <Surface>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Label>Clarify with Secretary</Label>
          <Body style={{ color: colors.muted, fontSize: 13 }}>Ask a question or describe the situation. The server’s preparation model can suggest a goal; you remain in control of the final brief.</Body>
        </View>
        <Button title="Start over" onPress={() => void resetConversation()} tone="quiet" compact disabled={chatWorking || working} />
      </Row>
      {chatMessages.map((message, index) => <View key={`${index}-${message.role}`} style={{
        alignSelf: message.role === 'you' ? 'flex-end' : 'stretch',
        maxWidth: message.role === 'you' ? '88%' : '100%',
        borderRadius: 17, padding: 13,
        backgroundColor: message.role === 'you' ? colors.bluePale : '#F7F7FA',
      }}>
        <Text style={{ color: message.role === 'you' ? colors.blue : colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 5 }}>
          {message.role === 'you' ? 'YOU' : 'SECRETARY · PREPARATION'}
        </Text>
        <Body>{message.text}</Body>
      </View>)}
      {preparationModel ? <Text style={{ color: colors.muted, fontSize: 12 }}>Preparation model · {preparationModel}</Text> : null}
      {proposedGoal ? <View style={{ borderWidth: 1, borderColor: '#CFE9DA', backgroundColor: colors.greenPale, borderRadius: 17, padding: 14, gap: 10 }}>
        <Text style={{ color: colors.green, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>SUGGESTED GOAL</Text>
        <Body style={{ color: '#356C52' }}>{proposedGoal}</Body>
        <Button title="Use as instruction" onPress={() => void useSuggestedGoal()} tone="green" compact />
      </View> : null}
      <Field label="Message" value={chatText} onChangeText={setChatText}
        placeholder="Ask for a clarification or add context…" multiline />
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Send to Secretary" onPress={() => void sendChatMessage(chatText)}
          loading={chatWorking} disabled={!chatText.trim() || working} />
        <Button title={recording ? 'Stop & transcribe' : 'Record a message'} onPress={() => void (recording ? stopVoice() : startVoice())}
          tone={recording ? 'green' : 'quiet'} loading={working} disabled={chatWorking} />
      </Row>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
        Voice starts only when tapped. After you stop, audio is sent to transcription and that text is submitted to the same preparation conversation. If the model is unavailable, the error is shown without fallback.
      </Text>
      {chatError ? <ErrorNotice message={chatError} /> : null}
    </Surface>
    <Surface>
      <Field label="Recipient" value={recipient} onChangeText={setRecipient} placeholder="Who is this follow-up for?" />
      <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="+1 555 010 2468" keyboardType="phone-pad" />
      <Field label="Instruction" value={instruction} onChangeText={setInstruction}
        placeholder="What should the Secretary ask or communicate?" multiline />
    </Surface>
    <Surface>
      <Label>Context cards · optional</Label>
      {loadingCards ? <Text style={{ color: colors.muted }}>Loading your cards…</Text> : cards.length ?
        cards.map(card => <View key={card.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink, fontWeight: '700' }}>{card.title}</Text>
              <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12 }}>{card.body}</Text></View>
            <Button title={selected.includes(card.id) ? 'Selected' : 'Add'} onPress={() => toggle(card.id)}
              tone={selected.includes(card.id) ? 'green' : 'quiet'} compact />
          </Row>
        </View>) : <Body style={{ color: colors.muted }}>No cards are available. You can still prepare an instruction for review.</Body>}
    </Surface>
    {error ? <ErrorNotice message={error} /> : null}
    <Button title="Prepare review" onPress={() => void prepare()} loading={working} disabled={chatWorking} />
  </ScrollPage>;
}
