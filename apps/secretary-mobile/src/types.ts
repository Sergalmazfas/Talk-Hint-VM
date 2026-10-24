export type User = { id?: string; email: string; name?: string };
export type ModelSettings = { model: string; voice: string; reasoningModel: string };
export type Card = {
  id: string; title: string; body: string; profileScope: 'personal' | 'work';
};
export type Review = {
  recipient: string; phoneNumber: string; instruction: string;
  cards: Array<{ id?: string; title: string; body?: string }>;
  model?: string; voice?: string;
};
export type SecretaryTask = {
  id: string; status: string; testOnly: boolean; review?: Review; summary?: string; warning?: string;
  transcript?: string; createdAt?: string; expiresAt?: string;
};
export type IncomingSetting = { numberId: string; cardIds: string[]; enabled: boolean; timeZone?: string };
export type Profiles = {
  numbers: Array<{ id: string; twilioNumber: string; name: string; type: string }>;
  contactPhone: string | null;
  incomingSettings: IncomingSetting[];
};
export type HistoryItem = {
  id: string; status?: string; createdAt?: string; startedAt?: string;
  instruction?: string; summary?: string; phoneNumber?: string;
  direction?: string; fromNumber?: string; toNumber?: string; secretaryTaskId?: string;
  kind?: 'call' | 'task';
};
export type HistoryDetail = { call?: Record<string, unknown>; task?: SecretaryTask };
export type MeResponse = {
  user: User; model: ModelSettings; testOnly: boolean; callingMode?: 'live' | 'test';
  legal: { approved: boolean };
};
export type AuthResponse = { token: string; user: User };
