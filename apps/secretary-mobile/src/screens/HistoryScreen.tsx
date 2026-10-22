import React, { useCallback, useState } from 'react';
import { savedHistoryContent } from '../historyContent';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api } from '../api';
import type { HistoryItem } from '../types';
import { Body, Button, ErrorNotice, Heading, LoadingRows, Pill, Row, ScrollPage, Surface } from '../components';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation';
import * as Clipboard from 'expo-clipboard';

export function HistoryScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<Array<{ record: HistoryItem; kind: 'call' | 'task' }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.history();
      const unified = result.items?.map(record => ({ record, kind: record.kind || 'call' as const }));
      setItems((unified || [
        ...(result.tasks || []).map(record => ({ record, kind: 'task' as const })),
        ...(result.calls || []).map(record => ({ record, kind: 'call' as const })),
      ]).sort((a, b) => new Date(b.record.startedAt || b.record.createdAt || 0).getTime() -
        new Date(a.record.startedAt || a.record.createdAt || 0).getTime()));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load history.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <ScrollPage>
    <Heading eyebrow="Your records">History</Heading>
    <Body style={{ color: colors.muted }}>Server-returned task and call records. No sample entries are added.</Body>
    {loading ? <LoadingRows /> : error ? <ErrorNotice message={error} onRetry={() => void load()} /> :
      items.length ? items.map(({ record, kind }, index) => <Pressable key={`${record.id}-${index}`}
        accessibilityRole="button" onPress={() => nav.navigate('HistoryDetail', {
          id: record.id, kind, taskId: kind === 'task' ? record.id : record.secretaryTaskId,
        })}>
        <Surface style={{ padding: 18 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Pill tone={record.status === 'completed' ? 'green' : 'blue'}>{(record.status || kind).toUpperCase()}</Pill>
            <Text style={{ color: colors.blue, fontSize: 20 }}>›</Text>
          </Row>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '800' }}>
            {record.instruction || record.summary || record.toNumber || record.fromNumber || record.phoneNumber || 'Secretary record'}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {[record.direction, record.status, record.startedAt || record.createdAt ?
              new Date(record.startedAt || record.createdAt || '').toLocaleString() : 'Date unavailable'].filter(Boolean).join(' · ')}
          </Text>
        </Surface>
      </Pressable>) :
        <Surface style={{ alignItems: 'center', paddingVertical: 34 }}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800' }}>No history yet</Text>
          <Body style={{ color: colors.muted, textAlign: 'center' }}>When the server has Secretary records, they’ll appear here. This is an empty result, not demo data.</Body>
        </Surface>}
  </ScrollPage>;
}

export function HistoryDetailScreen({ route }: { route: { params: { id: string; taskId?: string; kind?: 'call' | 'task' } } }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [loading, setLoading] = useState(true);
  React.useEffect(() => {
    setLoading(true); setError(''); setNotice('');
    void (async () => {
      try {
        if (route.params.kind === 'task') {
          setDetail(await api.taskReport(route.params.taskId || route.params.id));
          return;
        }
        const history = await api.historyDetail(route.params.id);
        const call = history.call;
        const secretaryTaskId = call && typeof call.secretaryTaskId === 'string' ? call.secretaryTaskId : route.params.taskId;
        if (secretaryTaskId) {
          try {
            const report = await api.taskReport(secretaryTaskId);
            setDetail({ ...history, task: report.task });
          } catch {
            setDetail(history);
            setNotice('The linked Secretary report is not available. Call details are still shown.');
          }
        } else setDetail(history);
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not load record.'); }
      finally { setLoading(false); }
    })();
  }, [route.params.id, route.params.kind, route.params.taskId]);
  const call = detail?.call && typeof detail.call === 'object' ? detail.call as Record<string, unknown> : null;
  const task = detail?.task && typeof detail.task === 'object' ? detail.task as Record<string, unknown> : null;
  const content = savedHistoryContent(call, task);
  const copy = async (kind: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    try {
      await Clipboard.setStringAsync(value);
      setCopied(kind);
      setTimeout(() => setCopied(''), 1600);
    } catch { setError('Could not copy this text. Your saved history has not changed.'); }
  };
  return <ScrollPage>
    <Heading eyebrow="Server record">Details</Heading>
    {loading ? <LoadingRows /> : error ? <ErrorNotice message={error} /> : detail ?
      <>
        {notice ? <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}><Body style={{ color: colors.amber }}>{notice}</Body></Surface> : null}
        {call ? <Surface>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Call details</Text>
          <DetailRow label="Direction" value={call.direction} />
          <DetailRow label="Status" value={call.status} />
          <DetailRow label="From" value={call.fromNumber} />
          <DetailRow label="To" value={call.toNumber} />
          <DetailRow label="Started" value={call.startedAt} />
          <DetailRow label="Ended" value={call.endedAt} />
          <Button title={copied === 'phone' ? 'Copied' : 'Copy phone number'}
            onPress={() => void copy('phone', call.direction === 'incoming' ? call.fromNumber : call.toNumber)} tone="quiet" compact />
        </Surface> : null}
        {content.callSummary ? <SavedText title="Call summary" value={content.callSummary}
          copied={copied === 'call-summary'} onCopy={() => void copy('call-summary', content.callSummary)} /> : null}
        {content.callTranscript ? <SavedText title="Call transcript" value={content.callTranscript}
          copied={copied === 'call-transcript'} onCopy={() => void copy('call-transcript', content.callTranscript)} /> : null}
        {!content.callSummary && !content.taskSummary ? <Surface><Body style={{ color: colors.muted }}>No saved summary is available for this record.</Body></Surface> : null}
        {!content.callTranscript && !content.taskTranscript ? <Surface><Body style={{ color: colors.muted }}>No saved transcript is available for this record. No text has been invented.</Body></Surface> : null}
        {task ? <>
          <Surface>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Secretary report</Text>
              {typeof task.status === 'string' ? <Pill tone={task.status === 'completed' ? 'green' : 'blue'}>{task.status.toUpperCase()}</Pill> : null}
            </Row>
            <DetailRow label="Recipient" value={
              task.review && typeof task.review === 'object' ? (task.review as Record<string, unknown>).recipient : task.recipient
            } />
            <DetailRow label="Phone number" value={
              task.review && typeof task.review === 'object' ? (task.review as Record<string, unknown>).phoneNumber : task.phoneNumber
            } />
            <DetailRow label="Instruction" value={
              task.review && typeof task.review === 'object' ? (task.review as Record<string, unknown>).instruction : task.instruction
            } />
            <DetailRow label="Created" value={task.createdAt} />
            <Button title={copied === 'task-phone' ? 'Copied' : 'Copy phone number'}
              onPress={() => void copy('task-phone', task.phoneNumber)} tone="quiet" compact />
          </Surface>
          {content.taskSummary ? <SavedText title="Secretary summary" value={content.taskSummary}
            copied={copied === 'task-summary'} onCopy={() => void copy('task-summary', content.taskSummary)} /> : null}
          {content.taskTranscript ? <SavedText title="Secretary transcript" value={content.taskTranscript}
            copied={copied === 'task-transcript'} onCopy={() => void copy('task-transcript', content.taskTranscript)} /> : null}
        </> : !call ? <Surface><Body style={{ color: colors.muted }}>This server record has no call or Secretary report details.</Body></Surface> : null}
      </> : null}
  </ScrollPage>;
}

function SavedText({ title, value, copied, onCopy }: { title: string; value: string; copied: boolean; onCopy: () => void }) {
  return <Surface>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>{title}</Text>
      <Button title={copied ? 'Copied' : 'Copy'} onPress={onCopy} tone="quiet" compact />
    </Row>
    <Text selectable style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{value}</Text>
  </Surface>;
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  const isDate = ['Started', 'Ended', 'Created'].includes(label);
  const parsed = typeof value === 'string' && isDate ? new Date(value) : null;
  const text = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString()
    : typeof value === 'string' || typeof value === 'number' ? String(value)
      : value instanceof Date ? value.toLocaleString() : 'Not available';
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderTopWidth: 1,
    borderColor: colors.line, paddingVertical: 11 }}>
    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'right', flexShrink: 1 }}>{text}</Text>
  </View>;
}
