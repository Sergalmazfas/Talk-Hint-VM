import React, { useCallback, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, getApiOrigin, resolveBackendUrl } from '../api';
import { validateOrigin } from '../config';
import { useAuth } from '../auth';
import type { Profiles } from '../types';
import { Body, Button, ErrorNotice, Field, Heading, Label, LoadingRows, Pill, Row, ScrollPage, Surface } from '../components';
import { colors } from '../theme';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';

type CalendarState = {
  [key: string]: unknown;
  state?: string;
  calendar?: { id?: string; summary?: string } | null;
  calendars?: Array<{ id: string; summary: string }>;
  calendarError?: string;
  error?: string;
};

export function SettingsScreen() {
  const auth = useAuth();
  const [origin, setOrigin] = useState(getApiOrigin());
  const [originMessage, setOriginMessage] = useState('');
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [calendarByNumber, setCalendarByNumber] = useState<Record<string, CalendarState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [calendarBlocker, setCalendarBlocker] = useState('');
  const [calendarNotice, setCalendarNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.profiles();
      setProfiles(data);
      const states: Record<string, CalendarState> = {};
      const workNumbers = (data.numbers || []).filter(number => number.type?.toLowerCase() === 'work');
      await Promise.all(workNumbers.map(async n => {
        try {
          const status = await api.calendar(n.id) as CalendarState;
          states[n.id] = status;
          if (status.state === 'connected' || status.state === 'selection_required') {
            try {
              const list = await api.calendars(n.id);
              states[n.id] = { ...status, calendars: list.calendars || [] };
            } catch (e) {
              states[n.id] = { ...status, calendarError: e instanceof Error ? e.message : 'Calendar list unavailable.' };
            }
          }
        } catch (e) { states[n.id] = { error: e instanceof Error ? e.message : 'Calendar details unavailable.' }; }
      }));
      setCalendarByNumber(states);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Settings.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const updateOrigin = async () => {
    try {
      const next = validateOrigin(origin);
      if (next !== getApiOrigin()) await auth.changeOrigin(next);
      const clean = getApiOrigin();
      setOrigin(clean);
      setOriginMessage('Backend address saved. Sign in again to create a session for this backend.');
    } catch (e) { setOriginMessage(e instanceof Error ? e.message : 'Could not save origin.'); }
  };
  const connect = async (numberId: string) => {
    setBusy(numberId); setError(''); setCalendarBlocker(''); setCalendarNotice('');
    try {
      const result = await api.connectCalendar(numberId);
      const url = resolveBackendUrl(result.url);
      setCalendarNotice(`${result.notice} Google will return to TalkHint’s account page. Return to this app and refresh Settings to verify the connection.`);
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 409) {
        setCalendarBlocker('Google Calendar is not configured on this development backend yet (setup_required).');
      } else setError(e instanceof Error ? e.message : 'Could not start calendar connection.');
    }
    finally { setBusy(''); }
  };
  const disconnect = async (numberId: string) => {
    setBusy(numberId); setError('');
    try { await api.disconnectCalendar(numberId); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not disconnect calendar.'); }
    finally { setBusy(''); }
  };
  const selectCalendar = async (numberId: string, calendarId: string) => {
    setBusy(numberId); setError('');
    try { await api.selectCalendar(numberId, calendarId); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save calendar selection.'); }
    finally { setBusy(''); }
  };
  const copyEmail = async () => {
    if (!auth.me?.user.email) return;
    await Clipboard.setStringAsync(auth.me.user.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return <ScrollPage>
    <Heading eyebrow="Account & preferences">Settings</Heading>
    {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : null}
    {calendarBlocker ? <Surface style={{ backgroundColor: colors.amberPale, shadowOpacity: 0 }}>
      <Text style={{ color: colors.amber, fontWeight: '800' }}>Calendar connection blocked</Text>
      <Body style={{ color: '#755320' }}>{calendarBlocker}</Body>
    </Surface> : null}
    {calendarNotice ? <Surface style={{ backgroundColor: colors.greenPale, shadowOpacity: 0 }}>
      <Text style={{ color: colors.green, fontWeight: '800' }}>Finish in your browser</Text>
      <Body style={{ color: '#356C52' }}>{calendarNotice}</Body>
    </Surface> : null}
    <Surface>
      <Row style={{ justifyContent: 'space-between' }}><Label>ACCOUNT</Label><Pill tone="green">SIGNED IN</Pill></Row>
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>{auth.me?.user.name || auth.me?.user.email}</Text>
      <Body style={{ color: colors.muted }}>{auth.me?.user.email}</Body>
      <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 5 }}>
        <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>Saved contact / forwarding phone</Text>
        <Text style={{ color: colors.muted, fontSize: 14 }}>{profiles?.contactPhone || 'Not provided'}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>Existing forwarding contact only; this is not an allocated TalkHint phone number. No phone setter is available here.</Text>
      </View>
      <Row>
        <Button title={copied ? 'Email copied' : 'Copy email'} onPress={() => void copyEmail()} tone="quiet" compact />
        <Button title="Refresh account" onPress={() => void auth.refresh()} tone="quiet" compact />
      </Row>
      <Button title="Sign out" onPress={() => void auth.signOut()} tone="danger" />
    </Surface>
    <Surface>
      <Label>DEVELOPMENT SERVER</Label>
      <Field label="Backend origin" value={origin} onChangeText={setOrigin} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Button title="Save backend address" onPress={updateOrigin} tone="quiet" />
      {originMessage ? <Body style={{ color: colors.muted }}>{originMessage}</Body> : null}
      <Body style={{ color: colors.muted, fontSize: 12 }}>
        The permanent backend is https://talkhint.app. Native clients require HTTPS except loopback. Changing the origin clears the current session; sign in again for the selected backend.
      </Body>
      {Platform.OS === 'web' ? <Body style={{ color: colors.amber, fontSize: 12 }}>
        Web preview: sessionStorage is temporary and only lasts for this browser tab/session. This is not secure durable token storage.
      </Body> : null}
    </Surface>
    <Surface>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>SERVER MODEL</Label>
        <Pill tone={auth.me?.testOnly ? 'amber' : 'blue'}>{auth.me?.testOnly ? 'TEST ONLY' : 'ACCOUNT'}</Pill>
      </Row>
      <SettingValue name="Model" value={auth.me?.model.model} />
      <SettingValue name="Voice" value={auth.me?.model.voice} />
      <SettingValue name="Reasoning model" value={auth.me?.model.reasoningModel} />
      <Body style={{ color: colors.muted, fontSize: 12 }}>Model settings are provided by the server and are read-only in this client.</Body>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Legal approval: {auth.me?.legal.approved ? 'approved' : 'not approved'}</Text>
    </Surface>
    <Heading eyebrow="Existing assignments">Phone profiles</Heading>
    <Surface>
      <Label>PERSONAL CONTACT / FORWARDING PHONE</Label>
      <Body>{profiles?.contactPhone || 'Not set'}</Body>
      <Body style={{ color: colors.muted, fontSize: 12 }}>Your saved contact phone is not an allocated TalkHint number. Forwarding is not enabled or changed here.</Body>
      {profiles?.contactPhone ? <Button title="Copy contact phone" onPress={() => void Clipboard.setStringAsync(profiles.contactPhone!)} tone="quiet" compact /> : null}
      {(profiles?.numbers || []).map(number => <View key={number.id} style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14, gap: 7 }}>
        <Row><Pill tone={number.type === 'work' ? 'green' : 'blue'}>{number.type === 'work' ? 'WORK' : 'PERSONAL'}</Pill>
          <Text style={{ color: colors.ink, fontWeight: '700', flexShrink: 1 }}>{number.name}</Text></Row>
        <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800' }}>{number.twilioNumber}</Text>
        <Button title="Copy number" onPress={() => void Clipboard.setStringAsync(number.twilioNumber)} tone="quiet" compact />
      </View>)}
      {!profiles?.numbers.length ? <Body style={{ color: colors.muted }}>No allocated numbers. You can prepare TEST tasks without one.</Body> : null}
      <Body style={{ color: colors.muted, fontSize: 12 }}>Existing assignments are read-only. No number purchase, assignment, forwarding change or AI activation is available in this Dev client.</Body>
    </Surface>
    <Heading eyebrow="Calendar access">Booking is unavailable</Heading>
    <Surface style={{ backgroundColor: colors.bluePale, shadowOpacity: 0 }}>
      <Body style={{ color: '#345C9E' }}>Secretary calendar access is informational only. This client cannot book, change, or cancel appointments. Outlook, iCloud, and Cal.com are unavailable here.</Body>
    </Surface>
    {loading ? <LoadingRows /> : profiles?.numbers?.some(number => number.type?.toLowerCase() === 'work') ? profiles.numbers
      .filter(number => number.type?.toLowerCase() === 'work').map(number => {
      const cal = calendarByNumber[number.id] || {};
      const calendars = cal.calendars || [];
      const connected = cal.state === 'connected';
      const needsSelection = cal.state === 'selection_required';
      const needsSetup = cal.state === 'setup_required';
      const selectable = connected || needsSelection;
      return <Surface key={number.id}>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800' }}>{number.name || number.twilioNumber || 'Secretary number'}</Text>
        {cal.error ? <Text style={{ color: colors.muted }}>{String(cal.error)}</Text> : <>
          <Row><Pill tone={connected ? 'green' : 'amber'}>{connected ? 'CONNECTED' : needsSelection ? 'SELECT A CALENDAR' : needsSetup ? 'SETUP REQUIRED' : 'NOT CONNECTED'}</Pill>
            <Text style={{ color: colors.muted, fontSize: 12 }}>Google Calendar</Text></Row>
          {needsSetup ? <Body style={{ color: colors.amber }}>Google Calendar credentials are not configured on this development backend.</Body> : null}
          {selectable ? <>
            <Label>{needsSelection ? 'CHOOSE A CALENDAR' : 'AVAILABLE CALENDARS'}</Label>
            {calendars.length ? calendars.map(item =>
              <Row key={item.id} style={{ justifyContent: 'space-between', paddingVertical: 5 }}>
                <Text style={{ color: colors.ink, flex: 1 }}>{item.summary}</Text>
                <Button title={cal.calendar?.id === item.id ? 'Selected' : 'Select'} onPress={() => void selectCalendar(number.id, item.id)}
                  tone={cal.calendar?.id === item.id ? 'green' : 'quiet'} compact disabled={busy === number.id} />
              </Row>) : <Body style={{ color: colors.muted }}>No calendars returned by the server.</Body>}
            {cal.calendarError ? <Body style={{ color: colors.amber }}>{String(cal.calendarError)}</Body> : null}
            <Button title="Disconnect Google Calendar" onPress={() => void disconnect(number.id)} tone="quiet" loading={busy === number.id} />
          </> : <Button title={needsSetup ? 'Backend setup required' : 'Connect Google Calendar'}
            onPress={() => void connect(number.id)} loading={busy === number.id} disabled={needsSetup} tone="quiet" />}
        </>}
      </Surface>;
    }) : !loading ? <Surface><Body style={{ color: colors.muted }}>No work numbers are configured. Calendar settings are shown for work numbers only; this client cannot assign or activate phone numbers.</Body></Surface> : null}
    <Button title="Refresh Settings" onPress={() => void load()} tone="quiet" />
  </ScrollPage>;
}

function SettingValue({ name, value }: { name: string; value?: string }) {
  return <View style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, gap: 4 }}>
    <Text style={{ color: colors.muted, fontSize: 12 }}>{name}</Text>
    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{value || 'Not provided'}</Text>
  </View>;
}
