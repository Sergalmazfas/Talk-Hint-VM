/**
 * Goal State Engine
 * 
 * State-machine для отслеживания цели разговора.
 * Детерминированная логика, без GPT.
 */

import {
  GoalState,
  GoalType,
  GoalStatus,
  Speaker,
  SlotMap,
  SLOT_KEYS,
  GOAL_REQUIREMENTS,
  GOAL_TYPE_KEYWORDS,
  createEmptyGoalState,
  NextBestAction,
  FastLayerMeta
} from "../shared/goalTypes";

import { extractAllSlots, mergeSlots } from "./slotExtractors";

const CONFIDENCE_THRESHOLD_FOR_CHANGE = 0.75;
const STEER_COOLDOWN_MS = 5000;

export interface UtteranceInput {
  speaker: Speaker;
  text: string;
  ts: number;
  fastMeta?: FastLayerMeta;
}

export interface GoalUpdateResult {
  state: GoalState;
  goalChanged: boolean;
  goalAchieved: boolean;
  newSlots: Partial<SlotMap>;
}

export class GoalEngine {
  private state: GoalState;
  
  constructor(callId: string) {
    this.state = createEmptyGoalState(callId);
  }
  
  getState(): GoalState {
    return { ...this.state };
  }
  
  updateOnUtterance(input: UtteranceInput): GoalUpdateResult {
    const { speaker, text, ts, fastMeta } = input;
    const lowerText = text.toLowerCase();
    
    this.state.turnIndex++;
    this.state.lastSpeaker = speaker;
    this.state.lastUpdateAt = ts;
    
    if (fastMeta) {
      this.state.fastLayer = { ...this.state.fastLayer, ...fastMeta };
    }
    
    this.state.history.push({
      ts,
      speaker,
      text,
      goalType: this.state.goalType,
      status: this.state.status
    });
    
    const prevGoalType = this.state.goalType;
    const prevStatus = this.state.status;
    
    const { goalType: detectedGoal, confidence } = this.detectGoalType(lowerText, prevGoalType);
    
    let goalChanged = false;
    if (detectedGoal !== prevGoalType && confidence >= CONFIDENCE_THRESHOLD_FOR_CHANGE) {
      this.state.goalType = detectedGoal;
      this.state.confidence = confidence;
      this.state.currentGoal = this.getGoalDescription(detectedGoal);
      this.state.status = "changed";
      goalChanged = true;
      console.log(`[GoalEngine] ${this.state.callId} Goal changed: ${prevGoalType} -> ${detectedGoal} (conf: ${confidence.toFixed(2)})`);
    } else if (detectedGoal !== prevGoalType) {
      this.state.candidateGoalType = detectedGoal;
      this.state.candidateConfidence = confidence;
    } else {
      this.state.confidence = Math.max(this.state.confidence, confidence);
    }
    
    const extractedSlots = extractAllSlots(text);
    const newSlots: Partial<SlotMap> = {};
    for (const key of SLOT_KEYS) {
      if (extractedSlots[key] && !this.state.slots[key]) {
        newSlots[key] = extractedSlots[key]!;
      }
    }
    this.state.slots = mergeSlots(this.state.slots, extractedSlots);
    
    this.state.missingSlots = this.computeMissingSlots(this.state.goalType, this.state.slots);
    
    let goalAchieved = false;
    if (prevStatus !== "achieved" && this.checkAchieved(this.state.goalType, this.state.slots, lowerText)) {
      this.state.status = "achieved";
      this.state.achievedAt = ts;
      this.state.achievedReason = this.getAchievedReason(this.state.goalType, this.state.slots, lowerText);
      goalAchieved = true;
      console.log(`[GoalEngine] ${this.state.callId} Goal ACHIEVED: ${this.state.goalType} - ${this.state.achievedReason}`);
    } else if (this.state.status !== "achieved" && !goalChanged) {
      this.state.status = "in_progress";
    }
    
    this.state.nextBestAction = this.computeNextBestAction();
    
    return {
      state: this.getState(),
      goalChanged,
      goalAchieved,
      newSlots
    };
  }
  
  detectGoalType(text: string, currentGoal: GoalType): { goalType: GoalType; confidence: number } {
    const scores: Record<GoalType, number> = {
      booking: 0,
      pricing: 0,
      support: 0,
      info: 0,
      negotiation: 0,
      other: 0
    };
    
    for (const [goal, keywords] of Object.entries(GOAL_TYPE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          scores[goal as GoalType] += 1;
        }
      }
    }
    
    let maxScore = 0;
    let bestGoal: GoalType = currentGoal;
    
    for (const [goal, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestGoal = goal as GoalType;
      }
    }
    
    if (maxScore === 0) {
      return { goalType: currentGoal, confidence: this.state.confidence };
    }
    
    const confidence = Math.min(0.3 + maxScore * 0.25, 1.0);
    
    if (bestGoal === currentGoal) {
      return { goalType: currentGoal, confidence: Math.max(this.state.confidence, confidence) };
    }
    
    return { goalType: bestGoal, confidence };
  }
  
  computeMissingSlots(goalType: GoalType, slots: SlotMap): (keyof SlotMap)[] {
    const requirements = GOAL_REQUIREMENTS[goalType];
    const missing: (keyof SlotMap)[] = [];
    
    for (const slot of requirements.requiredSlots) {
      if (!slots[slot]) {
        missing.push(slot);
      }
    }
    
    return missing;
  }
  
  checkAchieved(goalType: GoalType, slots: SlotMap, text: string): boolean {
    const requirements = GOAL_REQUIREMENTS[goalType];
    
    for (const phrase of requirements.achievedPhrases) {
      if (text.includes(phrase.toLowerCase())) {
        return true;
      }
    }
    
    if (requirements.requiredSlots.length > 0) {
      const allSlotsFilled = requirements.requiredSlots.every(slot => slots[slot] !== null);
      if (allSlotsFilled) {
        return true;
      }
    }
    
    return false;
  }
  
  getAchievedReason(goalType: GoalType, slots: SlotMap, text: string): string {
    const requirements = GOAL_REQUIREMENTS[goalType];
    
    for (const phrase of requirements.achievedPhrases) {
      if (text.includes(phrase.toLowerCase())) {
        return `Confirmation phrase detected: "${phrase}"`;
      }
    }
    
    if (goalType === "booking" && slots.date && slots.time) {
      return `Booking confirmed: ${slots.date} at ${slots.time}`;
    }
    
    if (goalType === "pricing" && slots.price) {
      return `Price confirmed: $${slots.price}`;
    }
    
    return "Goal requirements met";
  }
  
  getGoalDescription(goalType: GoalType): string {
    const descriptions: Record<GoalType, string> = {
      booking: "Schedule an appointment",
      pricing: "Get pricing information",
      support: "Resolve an issue",
      info: "Get information",
      negotiation: "Negotiate terms",
      other: "General conversation"
    };
    return descriptions[goalType];
  }
  
  computeNextBestAction(): NextBestAction | undefined {
    if (this.state.status === "achieved") {
      return undefined;
    }
    
    if (this.state.missingSlots.length === 0) {
      return undefined;
    }
    
    const now = Date.now();
    const { lastSteerSlot, lastSteerAt } = this.state.steer;
    const { lastMissingSlot, lastFastTs } = this.state.fastLayer;
    
    for (const slot of this.state.missingSlots) {
      if (lastSteerSlot === slot && lastSteerAt && (now - lastSteerAt) < STEER_COOLDOWN_MS) {
        continue;
      }
      if (lastMissingSlot === slot && lastFastTs && (now - lastFastTs) < STEER_COOLDOWN_MS) {
        continue;
      }
      
      this.state.steer.lastSteerSlot = slot;
      this.state.steer.lastSteerAt = now;
      
      return {
        askSlot: slot,
        reason: `${this.state.goalType} needs ${slot}`,
        priority: this.getPriorityForSlot(slot)
      };
    }
    
    return undefined;
  }
  
  getPriorityForSlot(slot: keyof SlotMap): number {
    const priorities: Record<keyof SlotMap, number> = {
      date: 0.95,
      time: 0.9,
      phone: 0.85,
      name: 0.7,
      service: 0.8,
      price: 0.75,
      location: 0.6
    };
    return priorities[slot];
  }
  
  onFastPhraseSent(category: string, missingSlot?: string): void {
    this.state.fastLayer.lastFastTs = Date.now();
    this.state.fastLayer.lastCategory = category;
    if (missingSlot) {
      this.state.fastLayer.lastMissingSlot = missingSlot as keyof SlotMap;
    }
    console.log(`[GoalEngine] ${this.state.callId} Fast phrase sent: ${category}${missingSlot ? ` (slot: ${missingSlot})` : ''}`);
  }
  
  endCall(): void {
    this.state.callPhase = "ended";
    console.log(`[GoalEngine] ${this.state.callId} Call ended. Final status: ${this.state.status}, goalType: ${this.state.goalType}`);
  }
}

const engines: Map<string, GoalEngine> = new Map();

export function getOrCreateEngine(callId: string): GoalEngine {
  let engine = engines.get(callId);
  if (!engine) {
    engine = new GoalEngine(callId);
    engines.set(callId, engine);
    console.log(`[GoalEngine] Created engine for call: ${callId}`);
  }
  return engine;
}

export function removeEngine(callId: string): void {
  const engine = engines.get(callId);
  if (engine) {
    engine.endCall();
    engines.delete(callId);
    console.log(`[GoalEngine] Removed engine for call: ${callId}`);
  }
}

export function getEngine(callId: string): GoalEngine | undefined {
  return engines.get(callId);
}
