import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api, loadSavedApiOrigin, setApiOrigin } from './api';
import { colors } from './theme';
import { taskStorage, tokenStorage } from './storage';
import type { MeResponse } from './types';

type AuthContextValue = {
  me: MeResponse | null;
  busy: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  acceptToken: (token: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  changeOrigin: (origin: string) => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      setError(null);
      await loadSavedApiOrigin();
      const result = await api.me();
      setMe(result);
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 401) {
        try {
          const fresh = await api.refresh();
          await tokenStorage.set(fresh.token);
          setMe(await api.me());
          return;
        } catch { await tokenStorage.clear(); await taskStorage.clear(); }
      }
      setMe(null);
      if (e instanceof Error && !('status' in e && (e as { status: number }).status === 401)) setError(e.message);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadMe(); }, [loadMe]);

  const authenticate = useCallback(async (work: () => Promise<{ token: string }>) => {
    setBusy(true); setError(null);
    try {
      const result = await work();
      await tokenStorage.set(result.token);
      setMe(await api.me());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
      throw e;
    } finally { setBusy(false); }
  }, []);
  const signIn = useCallback((email: string, password: string) =>
    authenticate(() => api.login(email, password)), [authenticate]);
  const acceptToken = useCallback(async (token: string) => {
    setBusy(true); setError(null);
    try {
      await tokenStorage.set(token);
      setMe(await api.me());
    } catch (e) {
      await tokenStorage.clear();
      setError(e instanceof Error ? e.message : 'Secure sign-in could not be completed.');
      throw e;
    } finally { setBusy(false); }
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const fresh = await api.refresh();
      await tokenStorage.set(fresh.token);
      setMe(await api.me());
    } catch (e) { setError(e instanceof Error ? e.message : 'Refresh failed.'); throw e; }
    finally { setBusy(false); }
  }, []);
  const signOut = useCallback(async () => {
    setBusy(true);
    try { await api.logout(); } catch { /* local logout must remain available */ }
    try {
      await tokenStorage.clear();
      await taskStorage.clear();
    } finally { setMe(null); setBusy(false); }
  }, []);
  const changeOrigin = useCallback(async (origin: string) => {
    setBusy(true);
    try {
      try { await api.logout(); } catch { /* backend change must not strand local credentials */ }
      await tokenStorage.clear();
      await taskStorage.clear();
      await setApiOrigin(origin);
    } finally { setMe(null); setBusy(false); }
  }, []);
  const value = useMemo(() => ({ me, busy, error, signIn, acceptToken, refresh, signOut, changeOrigin }),
    [me, busy, error, signIn, acceptToken, refresh, signOut, changeOrigin]);

  if (busy && !me) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas }}>
      <ActivityIndicator color={colors.blue} />
    </View>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
