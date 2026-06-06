import { readFileSync } from "fs";
import { join } from "path";
import { log } from "./index";

export interface FastPhrase {
  id: string;
  category: "hold" | "ack" | "steer" | "clarify";
  goal_type: "booking" | "pricing" | "support" | "general";
  slot: "date" | "time" | "location" | "details" | "none";
  lang: string;
  text: string;
  translation_ru?: string;
  translation_es?: string;
  enabled: boolean;
  weight: number;
}

interface FastPhraseDB {
  phrases: FastPhrase[];
}

interface GetFastPhraseParams {
  goalType: string;
  missingSlot?: string;
  contextConfidence: "low" | "medium" | "high";
  language?: string;
}

export interface FastPhraseResult {
  text: string;
  translation: string;
  category: string;
  id: string;
  goalType: string;
  slot: string;
}

export const FAST_THRESHOLD_MS = 450;
export const FAST_COOLDOWN_MS = 1200;

let phrasesDB: FastPhraseDB | null = null;

function loadPhrases(): FastPhraseDB {
  if (phrasesDB) return phrasesDB;
  
  try {
    const filePath = join(process.cwd(), "server", "fastPhrases.json");
    const data = readFileSync(filePath, "utf-8");
    phrasesDB = JSON.parse(data) as FastPhraseDB;
    log(`[FastLayer] Loaded ${phrasesDB.phrases.length} phrases`, "fast");
    return phrasesDB;
  } catch (err: any) {
    log(`[FastLayer] Error loading phrases: ${err.message}`, "fast");
    phrasesDB = { phrases: [] };
    return phrasesDB;
  }
}

function getTranslation(phrase: FastPhrase, language: string): string {
  if (language === "ru" && phrase.translation_ru) {
    return phrase.translation_ru;
  }
  if (language === "es" && phrase.translation_es) {
    return phrase.translation_es;
  }
  return phrase.text;
}

function selectWeightedRandom(phrases: FastPhrase[]): FastPhrase | null {
  if (phrases.length === 0) return null;
  
  const totalWeight = phrases.reduce((sum, p) => sum + p.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const phrase of phrases) {
    random -= phrase.weight;
    if (random <= 0) return phrase;
  }
  
  return phrases[0];
}

export function getFastPhrase(params: GetFastPhraseParams): FastPhraseResult | null {
  const { goalType, missingSlot, contextConfidence, language = "ru" } = params;
  const db = loadPhrases();
  
  const enabledPhrases = db.phrases.filter(p => p.enabled);
  
  let candidates: FastPhrase[] = [];
  let selectedCategory: string;
  
  if (contextConfidence === "low") {
    selectedCategory = "hold";
    candidates = enabledPhrases.filter(p => 
      (p.category === "hold" || p.category === "ack") && 
      (p.goal_type === "general" || p.goal_type === goalType)
    );
  } else if (missingSlot && missingSlot !== "none") {
    selectedCategory = "steer";
    candidates = enabledPhrases.filter(p => 
      p.category === "steer" && 
      (p.goal_type === goalType || p.goal_type === "general") &&
      (p.slot === missingSlot || p.slot === "none")
    );
    
    if (candidates.length === 0) {
      candidates = enabledPhrases.filter(p => 
        p.category === "steer" && 
        p.goal_type === goalType
      );
    }
  } else {
    selectedCategory = "ack";
    candidates = enabledPhrases.filter(p => 
      (p.category === "ack" || p.category === "hold") && 
      (p.goal_type === "general" || p.goal_type === goalType)
    );
  }
  
  if (candidates.length === 0) {
    candidates = enabledPhrases.filter(p => 
      p.category === "hold" && p.goal_type === "general"
    );
  }
  
  const selected = selectWeightedRandom(candidates);
  
  if (!selected) {
    log(`[FastLayer] No phrase found for goal=${goalType}, slot=${missingSlot}, conf=${contextConfidence}`, "fast");
    return null;
  }
  
  const result: FastPhraseResult = {
    text: selected.text,
    translation: getTranslation(selected, language),
    category: selected.category,
    id: selected.id,
    goalType: selected.goal_type,
    slot: selected.slot
  };
  
  log(`[FastLayer] Selected: "${result.text}" (${result.category}, goal=${result.goalType}, slot=${result.slot})`, "fast");
  
  return result;
}

export function getClarifyPhrase(language: string = "ru"): FastPhraseResult | null {
  const db = loadPhrases();
  const clarifyPhrases = db.phrases.filter(p => p.enabled && p.category === "clarify");
  const selected = selectWeightedRandom(clarifyPhrases);
  
  if (!selected) return null;
  
  return {
    text: selected.text,
    translation: getTranslation(selected, language),
    category: "clarify",
    id: selected.id,
    goalType: selected.goal_type,
    slot: selected.slot
  };
}

export class FastLayerManager {
  private lastFastPhraseTime: number = 0;
  private gptResponsePending: boolean = false;
  private gptRequestStartTime: number = 0;
  private fastPhraseUsedThisTurn: boolean = false;
  private currentGoalType: string = "general";
  private missingSlot: string = "none";
  private language: string = "ru";
  
  private onFastPhrase: (phrase: FastPhraseResult, waitTimeMs: number) => void;
  
  constructor(onFastPhrase: (phrase: FastPhraseResult, waitTimeMs: number) => void) {
    this.onFastPhrase = onFastPhrase;
  }
  
  setGoal(goalType: string, missingSlot: string = "none") {
    this.currentGoalType = goalType;
    this.missingSlot = missingSlot;
    log(`[FastLayer] Goal updated: type=${goalType}, missingSlot=${missingSlot}`, "fast");
  }
  
  setLanguage(lang: string) {
    this.language = lang;
  }
  
  onGstUtteranceEnd() {
    this.gptResponsePending = true;
    this.gptRequestStartTime = Date.now();
    this.fastPhraseUsedThisTurn = false;
    
    setTimeout(() => {
      this.checkAndEmitFastPhrase();
    }, FAST_THRESHOLD_MS);
  }
  
  onGptResponseReceived() {
    this.gptResponsePending = false;
  }
  
  private checkAndEmitFastPhrase() {
    if (!this.gptResponsePending) {
      return;
    }
    
    if (this.fastPhraseUsedThisTurn) {
      return;
    }
    
    const now = Date.now();
    if (now - this.lastFastPhraseTime < FAST_COOLDOWN_MS) {
      log(`[FastLayer] Cooldown active, skipping`, "fast");
      return;
    }
    
    const waitTimeMs = now - this.gptRequestStartTime;
    
    const contextConfidence: "low" | "medium" | "high" = 
      this.currentGoalType === "general" ? "low" : "medium";
    
    const phrase = getFastPhrase({
      goalType: this.currentGoalType,
      missingSlot: this.missingSlot !== "none" ? this.missingSlot : undefined,
      contextConfidence,
      language: this.language
    });
    
    if (phrase) {
      this.fastPhraseUsedThisTurn = true;
      this.lastFastPhraseTime = now;
      
      log(`[FastLayer] Emitting fast phrase after ${waitTimeMs}ms wait: "${phrase.text}"`, "fast");
      this.onFastPhrase(phrase, waitTimeMs);
    }
  }
  
  reset() {
    this.gptResponsePending = false;
    this.fastPhraseUsedThisTurn = false;
    this.currentGoalType = "general";
    this.missingSlot = "none";
  }
}
