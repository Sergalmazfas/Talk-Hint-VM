import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, isLiveMode } from '../api';
import type { SecretaryTask } from '../types';
import { taskStorage } from '../storage';
import { Button, ErrorNotice, Heading, LoadingRows, Pill, ScrollPage, Surface, Body, Row } from '../components';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation';

function TaskTile({ task, onPress }: { task: SecretaryTask; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button">
    <Surface style={{ padding: 17 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pill tone={task.status === 'completed' ? 'green' : 'amber'}>{task.testOnly ? 'TEST' : 'CALL'} · {task.status.toUpperCase()}</Pill>
        <Text style={{ color: colors.blue, fontSize: 20, fontWeight: '700' }}>›</Text>
      </Row>
      <Text numberOfLines={2} style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>
        {task.review?.instruction || task.summary || 'Test follow-up task'}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        {task.review?.recipient || task.review?.phoneNumber || 'Review task details'}{task.createdAt ? ` · ${new Date(task.createdAt).toLocaleDateString()}` : ''}
      </Text>
    </Surface>
  </Pressable>;
}

export function SecretaryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tasks, setTasks] = useState<SecretaryTask[]>([]);
  const [restored, setRestored] = useState<SecretaryTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [restoreNotice, setRestoreNotice] = useState('');

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      setError(''); setRestoreNotice('');
      const [result, local] = await Promise.all([api.testTasks(), taskStorage.get<{ id?: string; clientRequestId?: string; task?: SecretaryTask }>()]);
      const listed = result.tasks || [];
      setTasks(listed);
      if (local?.id) {
        try {
          let same = listed.find(t => t.id === local.id);
          if (!same) {
            try { same = (await api.task(local.id)).task; }
            catch (e) { if (!local.task) throw e; same = local.task; }
          }
          setRestored(same);
          await taskStorage.set({ ...local, task: same });
        } catch {
          setRestored(null);
          setRestoreNotice('Your saved review is no longer available. Prepared reviews expire after 10 minutes; server history remains separate.');
          await taskStorage.clear();
        }
      } else setRestored(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load test tasks.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openTask = async (task: SecretaryTask) => {
    try {
      const result = await api.task(task.id);
      nav.navigate('TaskDetail', { taskId: result.task.id });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open task.'); }
  };
  return <ScrollPage refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.blue} />}>
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <Heading eyebrow="Secretary">Follow-up desk</Heading>
      <Pill tone={isLiveMode() ? 'blue' : 'amber'}>{isLiveMode() ? 'LIVE' : 'TEST'}</Pill>
    </Row>
    <Surface style={{ backgroundColor: colors.bluePale, shadowOpacity: 0 }}>
      <Text style={{ color: colors.blue, fontWeight: '800', fontSize: 17 }}>{isLiveMode() ? 'Your secretary can call for you.' : 'No calls are placed.'}</Text>
      <Body style={{ color: '#345C9E' }}>{isLiveMode() ? 'Review the exact number, instruction and cards. A real call starts only after your explicit confirmation.' : 'Tasks are prepared for review. A task completes only after you explicitly confirm it.'}</Body>
      <Button title={isLiveMode() ? 'Prepare a call' : 'Prepare a test task'} onPress={() => nav.navigate('Prepare')} />
    </Surface>
    {restored ? <>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 3 }}>Continue where you left off</Text>
      <TaskTile task={restored} onPress={() => void openTask(restored)} />
    </> : null}
    {restoreNotice ? <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}>
      <Body style={{ color: colors.amber }}>{restoreNotice}</Body>
    </Surface> : null}
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800' }}>{isLiveMode() ? 'Recent call tasks' : 'Recent test tasks'}</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>SERVER DATA</Text>
    </Row>
    {loading ? <LoadingRows /> : error ? <ErrorNotice message={error} onRetry={() => void load()} /> :
      tasks.length ? tasks.filter(t => t.id !== restored?.id).map(task =>
        <TaskTile key={task.id} task={task} onPress={() => void openTask(task)} />) :
        <Surface style={{ alignItems: 'center', paddingVertical: 30 }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.bluePale, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.blue, fontSize: 26, fontWeight: '700' }}>+</Text>
          </View>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800' }}>Nothing in the queue</Text>
          <Body style={{ color: colors.muted, textAlign: 'center' }}>Your server has no test tasks. Start one when you’re ready.</Body>
        </Surface>}
  </ScrollPage>;
}
