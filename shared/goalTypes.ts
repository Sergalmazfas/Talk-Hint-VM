/**
 * Goal State Engine Types
 * 
 * State-machine для отслеживания цели разговора,
 * собранных слотов и прогресса к достижению цели.
 */

export type GoalType =
  | "booking"
  | "pricing"
  | "support"
  | "info"
  | "negotiation"
  | "other";

export type GoalStatus = "in_progress" | "achieved" | "changed" | "failed" | "cancelled";

export type Speaker = "HON" | "GST";

export type CallPhase = "active" | "ended";

export interface SlotMap {
  date: string | null;
  time: string | null;
  phone: string | null;
  name: string | null;
  location: string | null;
  price: string | null;
  service: string | null;
}

export const SLOT_KEYS: (keyof SlotMap)[] = [
  "date", "time", "phone", "name", "location", "price", "service"
];

export interface FastLayerMeta {
  lastFastTs?: number;
  lastCategory?: string;
  lastMissingSlot?: string;
}

export interface SteerMeta {
  lastSteerSlot?: string;
  lastSteerAt?: number;
}

export interface NextBestAction {
  askSlot: keyof SlotMap;
  reason: string;
  priority: number;
}

export interface HistoryEntry {
  ts: number;
  speaker: Speaker;
  text: string;
  goalType?: GoalType;
  status?: GoalStatus;
}

export interface GoalState {
  callId: string;
  
  goalType: GoalType;
  currentGoal: string;
  confidence: number;
  status: GoalStatus;
  
  callPhase: CallPhase;
  lastSpeaker: Speaker | null;
  turnIndex: number;
  
  slots: SlotMap;
  missingSlots: (keyof SlotMap)[];
  
  candidateGoalType?: GoalType;
  candidateConfidence?: number;
  
  fastLayer: FastLayerMeta;
  steer: SteerMeta;
  
  nextBestAction?: NextBestAction;
  
  lastUpdateAt: number;
  achievedAt?: number;
  achievedReason?: string;
  
  history: HistoryEntry[];
}

export interface GoalRequirements {
  requiredSlots: (keyof SlotMap)[];
  achievedPhrases: string[];
}

export const GOAL_REQUIREMENTS: Record<GoalType, GoalRequirements> = {
  booking: {
    requiredSlots: ["date", "time"],
    achievedPhrases: ["confirmed", "booked", "see you", "see you then", "all set", "you're all set", "appointment is set"]
  },
  pricing: {
    requiredSlots: ["price"],
    achievedPhrases: ["that's the price", "total is", "costs", "it's $", "will be $"]
  },
  support: {
    requiredSlots: [],
    achievedPhrases: ["fixed", "works now", "done", "resolved", "that should fix", "ticket number", "case number"]
  },
  info: {
    requiredSlots: [],
    achievedPhrases: ["hope that helps", "does that answer", "let me know if", "anything else"]
  },
  negotiation: {
    requiredSlots: ["price"],
    achievedPhrases: ["deal", "agreed", "sounds good", "we have a deal", "let's do it"]
  },
  other: {
    requiredSlots: [],
    achievedPhrases: []
  }
};

export const GOAL_TYPE_KEYWORDS: Record<GoalType, string[]> = {
  booking: [
    "book", "schedule", "appointment", "reserve", "записаться", "запись",
    "can i come", "available", "slot", "when can", "what time"
  ],
  pricing: [
    "price", "cost", "how much", "rate", "fee", "charge", "сколько стоит",
    "цена", "стоимость", "quote", "estimate"
  ],
  support: [
    "help", "problem", "issue", "not working", "broken", "error", "fix",
    "проблема", "не работает", "ошибка", "support", "trouble"
  ],
  info: [
    "what is", "tell me", "explain", "information", "how does", "where is",
    "что такое", "расскажите", "подскажите", "info", "details"
  ],
  negotiation: [
    "discount", "cheaper", "lower price", "negotiate", "deal", "скидка",
    "дешевле", "can you do better", "best price"
  ],
  other: []
};

export function createEmptyGoalState(callId: string): GoalState {
  return {
    callId,
    goalType: "other",
    currentGoal: "",
    confidence: 0,
    status: "in_progress",
    callPhase: "active",
    lastSpeaker: null,
    turnIndex: 0,
    slots: {
      date: null,
      time: null,
      phone: null,
      name: null,
      location: null,
      price: null,
      service: null
    },
    missingSlots: [],
    fastLayer: {},
    steer: {},
    lastUpdateAt: Date.now(),
    history: []
  };
}
