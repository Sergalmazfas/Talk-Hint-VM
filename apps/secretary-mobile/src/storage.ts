import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'secretary.mobile.token';
const TASK_KEY = 'secretary.mobile.active-task';
const ORIGIN_KEY = 'secretary.mobile.dev-origin';

async function get(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}
async function set(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof sessionStorage === 'undefined') throw new Error('Session storage is unavailable in this browser.');
    sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function remove(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const tokenStorage = { get: () => get(TOKEN_KEY), set: (v: string) => set(TOKEN_KEY, v), clear: () => remove(TOKEN_KEY) };
export const originStorage = { get: () => get(ORIGIN_KEY), set: (v: string) => set(ORIGIN_KEY, v), clear: () => remove(ORIGIN_KEY) };
export const taskStorage = {
  get: async <T,>() => {
    const raw = await get(TASK_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { await remove(TASK_KEY); return null; }
  },
  set: (value: unknown) => set(TASK_KEY, JSON.stringify(value)),
  clear: () => remove(TASK_KEY),
};
