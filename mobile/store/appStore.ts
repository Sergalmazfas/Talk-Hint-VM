import { create } from 'zustand';

export type Language = 'ru' | 'es';
export type CallMode = 'live' | 'training';

export interface TranscriptItem {
  id: string;
  speaker: 'gst' | 'hon';
  text: string;
  translation?: string;
  isFinal: boolean;
  timestamp: number;
}

export interface HintItem {
  id: string;
  en: string;
  translation: string;
  timestamp: number;
}

export interface GoalState {
  type: string;
  status: 'pending' | 'in_progress' | 'achieved';
  currentGoal: string;
  missingSlots: string[];
}

interface AppState {
  serverUrl: string;
  language: Language;
  callMode: CallMode;
  goal: string;
  isConnected: boolean;
  isMicActive: boolean;
  transcript: TranscriptItem[];
  currentHints: HintItem[];
  goalState: GoalState | null;
  isGoalAchieved: boolean;

  setServerUrl: (url: string) => void;
  setLanguage: (lang: Language) => void;
  setCallMode: (mode: CallMode) => void;
  setGoal: (goal: string) => void;
  setConnected: (connected: boolean) => void;
  setMicActive: (active: boolean) => void;
  addTranscript: (item: Omit<TranscriptItem, 'id' | 'timestamp'>) => void;
  setHints: (hints: Array<{ en: string; translation: string }>) => void;
  setGoalState: (state: GoalState) => void;
  setGoalAchieved: (achieved: boolean) => void;
  clearSession: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  serverUrl: '',
  language: 'ru',
  callMode: 'live',
  goal: '',
  isConnected: false,
  isMicActive: false,
  transcript: [],
  currentHints: [],
  goalState: null,
  isGoalAchieved: false,

  setServerUrl: (url) => set({ serverUrl: url }),
  setLanguage: (language) => set({ language }),
  setCallMode: (callMode) => set({ callMode }),
  setGoal: (goal) => set({ goal }),
  setConnected: (isConnected) => set({ isConnected }),
  setMicActive: (isMicActive) => set({ isMicActive }),

  addTranscript: (item) =>
    set((state) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newItem: TranscriptItem = { ...item, id, timestamp: Date.now() };
      const updated = [...state.transcript, newItem].slice(-100);
      return { transcript: updated };
    }),

  setHints: (hints) =>
    set({
      currentHints: hints.map((h, i) => ({
        ...h,
        id: `hint-${Date.now()}-${i}`,
        timestamp: Date.now(),
      })),
    }),

  setGoalState: (goalState) => set({ goalState }),
  setGoalAchieved: (isGoalAchieved) => set({ isGoalAchieved }),

  clearSession: () =>
    set({
      transcript: [],
      currentHints: [],
      goalState: null,
      isGoalAchieved: false,
      isMicActive: false,
    }),
}));
