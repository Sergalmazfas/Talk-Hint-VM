import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api';
import type { SecretaryTask } from '../types';
import { taskStorage } from '../storage';
import { Body, Button, ErrorNotice, Heading, LoadingRows, Pill, Row, ScrollPage, Surface } from '../components';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation';

export function TaskDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'TaskDetail'>>();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { taskId } = route.params;
  const taskRef = useRef<SecretaryTask | null>(route.params.initialTask || null);
  const [task, setTask] = useState<SecretaryTask | null>(route.params.initialTask || null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(async () => {
    setLoading(!taskRef.current); setError('');
    try {
      const latest = (await api.task(taskId)).task;
      taskRef.current = latest;
      setTask(latest);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load test task.'); }
    finally { setLoading(false); }
  }, [taskId]);
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => {
      if (taskRef.current?.testOnly === false &&
        ['starting', 'ringing', 'connected', 'finalizing'].includes(taskRef.current.status)) void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]));
  const confirm = async () => {
    setWorking(true); setError('');
    try {
      const result = await api.confirmTask(taskId);
      taskRef.current = result.task;
      setTask(result.task);
      setConfirming(false);
      await taskStorage.set({ id: taskId, status: result.task.status, task: result.task });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm test task.'); }
    finally { setWorking(false); }
  };
  const cancel = async () => {
    setWorking(true);
    try {
      const result = await api.cancelTask(taskId);
      taskRef.current = result.task;
      setTask(result.task);
      setCancelling(false);
      await taskStorage.clear();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel test task.'); }
    finally { setWorking(false); }
  };
  if (loading) return <ScrollPage><LoadingRows /></ScrollPage>;
  if (!task) return <ScrollPage><Heading>Test task</Heading><ErrorNotice message={error || 'Task unavailable.'} onRetry={() => void load()} /></ScrollPage>;
  const prepared = task.status === 'prepared';
  return <ScrollPage>
    <Row style={{ justifyContent: 'space-between' }}>
      <Heading eyebrow="Secretary · Review">Task review</Heading>
      <Pill tone={task.status === 'completed' ? 'green' : 'amber'}>{task.testOnly ? 'TEST' : 'CALL'} · {task.status.toUpperCase()}</Pill>
    </Row>
    <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}>
      <Text style={{ color: colors.amber, fontSize: 17, fontWeight: '800' }}>{task.testOnly ? 'No calls are placed.' : 'Real telephone call'}</Text>
      <Body style={{ color: '#755320' }}>{task.testOnly ? 'Confirming changes only this server-side test task status.' : 'Confirming will call the exact number below. Refreshing or reopening this task will not start another call.'}</Body>
    </Surface>
    <Surface>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>RECIPIENT</Text>
      <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800' }}>{task.review?.recipient || 'Not provided'}</Text>
      <Text style={{ color: colors.muted }}>{task.review?.phoneNumber || 'No phone number'}</Text>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>INSTRUCTION</Text>
      <Body>{task.review?.instruction || task.summary || 'No instruction returned.'}</Body>
      <View style={{ height: 1, backgroundColor: colors.line }} />
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>CONTEXT CARDS</Text>
      {task.review?.cards?.length ? task.review.cards.map((card, i) => <View key={card.id || i} style={{ gap: 4 }}>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>{card.title}</Text>
        {card.body ? <Body style={{ color: colors.muted }}>{card.body}</Body> : null}
      </View>) : <Text style={{ color: colors.muted }}>No cards attached.</Text>}
      {task.review?.model || task.review?.voice ? <Text style={{ color: colors.muted, fontSize: 12 }}>
        {task.review.model ? `Model · ${task.review.model}` : ''}{task.review.voice ? `   Voice · ${task.review.voice}` : ''}
      </Text> : null}
      {task.status === 'prepared' && task.expiresAt ? <Text style={{ color: colors.amber, fontSize: 12 }}>
        Review expires {new Date(task.expiresAt).toLocaleString()}.
      </Text> : null}
    </Surface>
    {task.summary ? <Surface><Text style={{ color: colors.ink, fontWeight: '800' }}>Server summary</Text><Body>{task.summary}</Body></Surface> : null}
    {task.transcript ? <Surface><Text style={{ color: colors.ink, fontWeight: '800' }}>Server transcript</Text><Body>{task.transcript}</Body></Surface> : null}
    {task.warning ? <Surface style={{ backgroundColor: colors.amberPale }}><Body>{task.warning}</Body></Surface> : null}
    {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
    {prepared ? <>
      {confirming ? <Surface style={{ backgroundColor: colors.greenPale, shadowOpacity: 0 }}>
        <Text style={{ color: colors.green, fontSize: 17, fontWeight: '800' }}>{task.testOnly ? 'Confirm this TEST task?' : `Call ${task.review?.phoneNumber}?`}</Text>
        <Body style={{ color: '#356C52' }}>{task.testOnly ? 'This only advances the test-task status. No call or conversation is started.' : 'I authorize Secretary to place this real call using exactly the instruction and selected cards shown above.'}</Body>
        <Button title={task.testOnly ? 'Yes, confirm test task' : 'Confirm and call now'} onPress={() => void confirm()} loading={working} tone="green" />
        <Button title="Go back to review" onPress={() => setConfirming(false)} disabled={working} tone="quiet" />
      </Surface> : <Button title={task.testOnly ? 'Review complete · confirm test task' : 'Review complete · confirm call'} onPress={() => setConfirming(true)} tone="green" />}
      {cancelling ? <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}>
        <Text style={{ color: colors.amber, fontSize: 16, fontWeight: '800' }}>Cancel this review?</Text>
        <Body style={{ color: '#755320' }}>It will remain in server history as cancelled.</Body>
        <Button title="Yes, cancel task" onPress={() => void cancel()} disabled={working} tone="danger" />
        <Button title="Keep reviewing" onPress={() => setCancelling(false)} disabled={working} tone="quiet" />
      </Surface> : <Button title="Cancel review" onPress={() => setCancelling(true)} disabled={working} tone="quiet" />}
    </> : <Button title="Back" onPress={() => nav.goBack()} tone="quiet" />}
    {task.testOnly ? PlatformNote() : <Body>Results appear here and in call history. No automatic redial.</Body>}
  </ScrollPage>;
}

function PlatformNote() {
  return <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 12, paddingBottom: 8 }}>TEST ONLY · No real conversation is generated.</Text>;
}
