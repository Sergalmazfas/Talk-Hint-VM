import { defaultApiOrigin, validateOrigin } from './config';
import { originStorage, tokenStorage } from './storage';
import type { AuthResponse, Card, HistoryDetail, HistoryItem, MeResponse, Profiles, SecretaryTask } from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export class BrowserApprovalPendingError extends Error {}

let apiOrigin = defaultApiOrigin();
export function getApiOrigin(): string { return apiOrigin; }
export function resolveBackendUrl(value: string): string {
  if (!apiOrigin) throw new Error('Set a development backend origin before opening this link.');
  const resolved = new URL(value, `${apiOrigin}/`);
  if (resolved.origin !== apiOrigin) throw new Error('The development server returned a link outside its own origin.');
  return resolved.toString();
}
export async function setApiOrigin(value: string): Promise<string> {
  const clean = validateOrigin(value);
  await originStorage.set(clean);
  apiOrigin = clean;
  return apiOrigin;
}
export async function loadSavedApiOrigin(): Promise<void> {
  const saved = await originStorage.get();
  if (!saved) return;
  try { apiOrigin = validateOrigin(saved); }
  catch { await originStorage.clear(); }
}

async function request<T>(path: string, options: RequestInit = {}, auth = true): Promise<T> {
  if (!apiOrigin) throw new Error('Set a development backend origin in Settings before continuing.');
  const token = auth ? await tokenStorage.get() : null;
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/mobile-secretary${path}`, {
      ...options, headers,
    });
  } catch {
    throw new Error('Could not reach the development server. Check the backend origin and connection.');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.message === 'string') message = body.message;
      else if (typeof body.error === 'string') message = body.error;
    } catch { /* keep the useful status message */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, value?: unknown): RequestInit => ({
  method,
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});

export const api = {
  login: (email: string, password: string) => request<AuthResponse>('/login', json('POST', { email, password }), false),
  exchange: (sessionToken: string) => request<AuthResponse>('/exchange', json('POST', { sessionToken }), false),
  me: () => request<MeResponse>('/me'),
  refresh: () => request<AuthResponse>('/refresh', json('POST', {})),
  logout: () => request<void>('/logout', json('POST', {})),
  cards: () => request<{ cards: Card[] }>('/cards'),
  updateCard: (id: string, data: Pick<Card, 'title' | 'body' | 'profileScope'>) =>
    request<{ card: Card }>(`/cards/${encodeURIComponent(id)}`, json('PATCH', data)).then(result => result.card),
  profiles: () => request<Profiles>('/profiles'),
  saveProfileCards: (id: string, cardIds: string[]) =>
    request<void>(`/profiles/${encodeURIComponent(id)}/cards`, json('PUT', { cardIds })),
  history: () => request<{ items?: HistoryItem[]; calls?: HistoryItem[]; tasks?: HistoryItem[] }>('/history'),
  historyDetail: (id: string) => request<HistoryDetail>(`/history/${encodeURIComponent(id)}`),
  taskReport: (id: string) => request<{ task: SecretaryTask }>(`/tasks/${encodeURIComponent(id)}`),
  testTasks: () => request<{ tasks: SecretaryTask[] }>('/test-tasks'),
  prepare: (payload: { clientRequestId: string; recipient: string; phoneNumber: string; instruction: string; cardIds: string[] }) =>
    request<{ id: string; review: SecretaryTask['review']; status: 'prepared'; expiresAt: string }>('/prepare', json('POST', payload)),
  prepareMessage: (payload: { conversationId: string; clientMessageId: string; text: string }) =>
    request<{ reply: string; proposedGoal: string; model: string }>('/prepare/message', json('POST', payload)),
  resetPreparation: (conversationId: string) =>
    request<void>('/prepare/reset', json('POST', { conversationId })),
  confirmTask: (id: string) => request<{ task: SecretaryTask }>(`/test-tasks/${encodeURIComponent(id)}/confirm`, json('POST', {})),
  task: async (id: string) => {
    try { return await request<{ task: SecretaryTask }>(`/test-tasks/${encodeURIComponent(id)}`); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const { tasks } = await request<{ tasks: SecretaryTask[] }>('/test-tasks');
      const task = tasks.find(item => item.id === id);
      if (!task) throw error;
      return { task };
    }
  },
  cancelTask: (id: string) => request<{ task: SecretaryTask }>(`/test-tasks/${encodeURIComponent(id)}/cancel`, json('POST', {})),
  transcribe: (audio: string, mimeType: string) => request<{ text: string }>('/transcribe', json('POST', { audio, mimeType })),
  calendar: (numberId: string) => request<Record<string, unknown>>(`/calendar/${encodeURIComponent(numberId)}`),
  calendars: (numberId: string) => request<{ calendars: Array<{ id: string; summary: string }> }>(`/calendar/${encodeURIComponent(numberId)}/calendars`),
  selectCalendar: (numberId: string, calendarId: string) =>
    request<void>(`/calendar/${encodeURIComponent(numberId)}/selection`, json('PUT', { calendarId })),
  disconnectCalendar: (numberId: string) => request<void>(`/calendar/${encodeURIComponent(numberId)}/disconnect`, json('POST', {})),
  connectCalendar: (numberId: string) => request<{ url: string; notice: string }>(`/calendar/${encodeURIComponent(numberId)}/connect`, json('POST', {})),
  browserStart: (challenge: string) => request<{ id: string; url: string }>('/browser/start', json('POST', { challenge }), false),
  browserExchange: async (id: string, verifier: string) => {
    if (!apiOrigin) throw new Error('Set a development backend origin in Settings before continuing.');
    const response = await fetch(`${apiOrigin}/api/mobile-secretary/browser/exchange`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, verifier }),
    });
    if (response.status === 202) throw new BrowserApprovalPendingError('Approval is still pending in the browser.');
    if (!response.ok) throw new ApiError('Secure browser sign-in could not be exchanged.', response.status);
    return response.json() as Promise<AuthResponse>;
  },
};
