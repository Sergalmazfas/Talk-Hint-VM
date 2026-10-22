import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api';
import type { Card, Profiles } from '../types';
import { Body, Button, ErrorNotice, Field, Heading, LoadingRows, Pill, Row, ScrollPage, Surface } from '../components';
import { colors } from '../theme';

export function CardsScreen() {
  const [cards, setCards] = useState<Card[]>([]);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Card>>({});
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cardResult, profileResult] = await Promise.all([api.cards(), api.profiles()]);
      setCards(cardResult.cards || []);
      setProfiles(profileResult);
      const next: Record<string, string[]> = {};
      for (const setting of profileResult.incomingSettings || []) next[setting.numberId] = setting.cardIds || [];
      setPermissions(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load cards.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const editCard = (card: Card) => { setDrafts(v => ({ ...v, [card.id]: { ...card } })); setEditing(card.id); };
  const change = (id: string, key: keyof Card, value: string | boolean) => {
    setDrafts(v => ({ ...v, [id]: { ...v[id], [key]: value } as Card }));
  };
  const saveCard = async (id: string) => {
    const card = drafts[id];
    if (!card) return;
    setSaving(id); setError('');
    try {
      const updated = await api.updateCard(id, { title: card.title, body: card.body, profileScope: card.profileScope });
      setCards(items => items.map(item => item.id === id ? updated : item));
      setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save card.'); }
    finally { setSaving(null); }
  };
  const togglePermission = (numberId: string, cardId: string) => {
    setPermissions(current => {
      const active = current[numberId] || [];
      return { ...current, [numberId]: active.includes(cardId) ? active.filter(id => id !== cardId) : [...active, cardId] };
    });
  };
  const savePermissions = async (numberId: string) => {
    setSaving(numberId); setError('');
    try { await api.saveProfileCards(numberId, permissions[numberId] || []); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save card permissions.'); }
    finally { setSaving(null); }
  };
  const numberList = profiles?.numbers || [];
  return <ScrollPage>
    <Heading eyebrow="Context library">Cards</Heading>
    <Body style={{ color: colors.muted }}>Keep each profile’s context accurate. Changes save to your account; nothing here activates an incoming number.</Body>
    {loading ? <LoadingRows /> : error ? <ErrorNotice message={error} onRetry={() => void load()} /> :
      cards.length ? cards.map(card => {
        const active = editing === card.id;
        const draft = drafts[card.id] || card;
        return <Surface key={card.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Pill>{card.profileScope === 'work' ? 'WORK' : 'PERSONAL'}</Pill>
            <Button title={active ? 'Discard' : 'Edit card'} onPress={() => active ? setEditing(null) : editCard(card)} tone="quiet" compact />
          </Row>
          {active ? <>
            <Field label="Title" value={draft.title} onChangeText={v => change(card.id, 'title', v)} />
            <Field label="Card details" value={draft.body} onChangeText={v => change(card.id, 'body', v)} multiline />
            <Row>
              <Button title={draft.profileScope === 'personal' ? 'Personal' : 'Switch to personal'} onPress={() => change(card.id, 'profileScope', 'personal')} tone={draft.profileScope === 'personal' ? 'green' : 'quiet'} compact />
              <Button title={draft.profileScope === 'work' ? 'Work' : 'Switch to work'} onPress={() => change(card.id, 'profileScope', 'work')} tone={draft.profileScope === 'work' ? 'green' : 'quiet'} compact />
            </Row>
            <Button title="Save card" onPress={() => void saveCard(card.id)} loading={saving === card.id} />
          </> : <>
            <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800' }}>{card.title}</Text>
            <Body style={{ color: colors.muted }}>{card.body}</Body>
          </>}
        </Surface>;
      }) : <Surface><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>No cards yet</Text>
        <Body style={{ color: colors.muted }}>The server returned an empty card library. Cards can be added in your TalkHint account.</Body></Surface>}
    {numberList.length ? <>
      <Heading eyebrow="Incoming profiles">Card permissions</Heading>
      <Surface style={{ backgroundColor: colors.bluePale, shadowOpacity: 0 }}>
        <Body style={{ color: '#345C9E' }}>Choose which cards a number may use. Saving permissions does not activate or turn on the number.</Body>
      </Surface>
      {numberList.map(number => {
        const selected = permissions[number.id] || [];
        return <Surface key={number.id}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>{number.name || number.twilioNumber || 'Incoming profile'}</Text>
          {!cards.length ? <Body style={{ color: colors.muted }}>No cards to assign.</Body> :
            cards.filter(card => card.profileScope === 'work').map(card => <Pressable key={card.id} onPress={() => togglePermission(number.id, card.id)} style={{ paddingVertical: 8 }}>
              <Row>
                <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1, borderColor: selected.includes(card.id) ? colors.blue : colors.line,
                  backgroundColor: selected.includes(card.id) ? colors.blue : '#F7F7FA', alignItems: 'center', justifyContent: 'center' }}>
                  {selected.includes(card.id) ? <Text style={{ color: '#FFF', fontWeight: '800' }}>✓</Text> : null}
                </View>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>{card.title}</Text>
              </Row>
            </Pressable>)}
          <Button title="Save permissions" onPress={() => void savePermissions(number.id)} loading={saving === number.id} />
        </Surface>;
      })}
    </> : null}
  </ScrollPage>;
}
