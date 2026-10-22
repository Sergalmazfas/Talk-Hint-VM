import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { ScrollPage, Surface, Heading, Body, Field, Button, ErrorNotice, Pill } from '../components';
import { useAuth } from '../auth';
import { api, getApiOrigin, setApiOrigin, resolveBackendUrl, BrowserApprovalPendingError } from '../api';
import { colors } from '../theme';

export function SignInScreen() {
  const auth = useAuth();
  const [origin, setOrigin] = useState(getApiOrigin());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [browserStatus, setBrowserStatus] = useState('');
  const [localError, setLocalError] = useState('');
  const [working, setWorking] = useState(false);
  const saveOrigin = async () => {
    try { const clean = await setApiOrigin(origin); setOrigin(clean); setLocalError(''); return true; }
    catch (e) { setLocalError(e instanceof Error ? e.message : 'Invalid backend origin.'); return false; }
  };
  const login = async () => {
    if (!await saveOrigin()) return;
    if (!email.trim() || !password) { setLocalError('Enter your account email and password.'); return; }
    setWorking(true);
    try { await auth.signIn(email.trim(), password); } catch { /* auth context exposes the error */ }
    finally { setWorking(false); }
  };
  const browserSignIn = async () => {
    if (!await saveOrigin()) return;
    setLocalError('');
    setWorking(true);
    try {
      const bytes = await Crypto.getRandomBytesAsync(32);
      const verifier = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
      const handoff = await api.browserStart(challenge);
      const browserUrl = resolveBackendUrl(handoff.url);
      setBrowserStatus('Finish sign-in and explicitly approve TalkHint in the secure browser window.');
      await WebBrowser.openBrowserAsync(browserUrl);
      setBrowserStatus('Waiting for browser approval…');
      for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
          const result = await api.browserExchange(handoff.id, verifier);
          await auth.acceptToken(result.token);
          return;
        } catch (e) {
          if (!(e instanceof BrowserApprovalPendingError)) throw e;
          await new Promise(resolve => setTimeout(resolve, 1800));
        }
      }
      throw new Error('Browser approval timed out. Return to the browser and try again.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Secure browser sign-in failed.';
      setLocalError(message);
      setBrowserStatus('');
    } finally { setWorking(false); }
  };
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollPage style={{ justifyContent: 'center', flexGrow: 1, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <View style={{ gap: 17 }}>
        <Pill tone="amber">DEVELOPMENT CLIENT</Pill>
        <Heading eyebrow="TalkHint / Secretary">A quieter way to follow up.</Heading>
        <Body style={{ color: colors.muted }}>Sign in with an existing TalkHint account. This client is test-only and does not place calls.</Body>
      </View>
      <Surface>
        <Field label="Development backend origin" value={origin} onChangeText={setOrigin}
          placeholder="https://dev-api.example.test" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com"
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="Your account password" secureTextEntry />
        {localError || auth.error ? <ErrorNotice message={localError || auth.error || ''} /> : null}
        <Button title="Sign in" onPress={() => void login()} loading={working} />
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          Session tokens are stored in the device secure store. Web preview uses temporary session storage only.
        </Text>
      </Surface>
      <Surface style={{ paddingVertical: 14 }}>
        <Body style={{ color: colors.muted }}>Secure browser sign-in uses a one-time PKCE exchange. The browser requires an existing account login and a separate explicit approval step. No raw session token is shown or copied here.</Body>
        {browserStatus ? <Text style={{ color: colors.blue, fontSize: 13 }}>{browserStatus}</Text> : null}
        <Button title="Sign in securely in browser" onPress={() => void browserSignIn()} loading={working} tone="quiet" />
      </Surface>
    </ScrollPage>
  </KeyboardAvoidingView>;
}
