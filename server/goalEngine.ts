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
import { isQuestionOrActionRequest } from "./waitState";

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
  /** The owner explicitly abandoned/replaced the original goal on this turn. */
  goalCancelled: boolean;
  newSlots: Partial<SlotMap>;
}

// Owner phrases that explicitly abandon the current goal, e.g.
// "Forget the phone issue, I only want to check my payment now",
// "Never mind the appointment", "Don't worry about that anymore",
// "I no longer need the repair". Deliberately conservative: only clear,
// explicit abandonment counts — a mere topic drift must NOT cancel the goal
// (that's what the compass/soft-return prompt rules handle).
// Each pattern requires a topic OBJECT after the abandonment verb ("forget the
// phone issue"), never a bare discourse marker: "forget it, let's continue" and
// "never mind that, back to the phone" are normal conversational speech and
// must NOT cancel. A resume marker anywhere in the turn also vetoes cancelling.
const GOAL_CANCELLATION_PATTERNS: RegExp[] = [
  /\bforget (about )?(the|that|this|my) [a-zа-яё]+/i,
  /\bnever mind (about )?(the|that|this|my) [a-zа-яё]+/i,
  /\bdon'?t worry about (the|that|this|my) [a-zа-яё]+/i,
  /\bno longer (want|wanted|need|needed|necessary|important|care)\b/i,
  /\b(don'?t|do not) (want|need) (the|that|this|it) anymore\b/i,
  /\bnot (interested in|worried about) (the|that|this|it)\b.*\banymore\b/i,
  /\blet'?s drop (the|that|this) [a-zа-яё]+/i,
  /\bзабудь (про|о|об) /i,
  /\bуже не (нужно|надо|важно)\b/i,
];

// Continuation/resume markers: the owner is steering BACK, not abandoning.
const GOAL_RESUME_PATTERNS =
  /\b(back to|let'?s continue|let'?s get back|as i was saying|anyway,? (so|back)|вернемся|вернёмся|продолжим)\b/i;

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
    
    // Explicit goal cancellation — ONLY the owner can abandon their own goal.
    // A cancelled goal stops driving anything (no achievement, no next-best-
    // action steering); a new goal may still be detected on this same turn or
    // any later turn ("Forget the phone issue, I only want to check my payment
    // now" cancels support AND opens pricing in one utterance).
    let goalCancelled = false;
    if (speaker === "HON" && prevStatus !== "achieved" &&
        !GOAL_RESUME_PATTERNS.test(text) &&
        GOAL_CANCELLATION_PATTERNS.some((re) => re.test(text))) {
      goalCancelled = true;
      this.state.status = "cancelled";
      console.log(`[GoalEngine] ${this.state.callId} Goal CANCELLED by owner: "${text.slice(0, 60)}"`);
    }
    
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
    
    // A cancelled goal must not keep driving slot steering (fast layer reads
    // missingSlots): with no active goal there is nothing to fill. If a new
    // goal was detected on the same turn, status is "changed" and missing
    // slots are computed normally for the NEW goal.
    this.state.missingSlots = this.state.status === "cancelled"
      ? []
      : this.computeMissingSlots(this.state.goalType, this.state.slots);
    
    let goalAchieved = false;
    // A turn that cancels/replaces the goal can never also confirm achievement
    // — "Forget the phone issue, I only want to know how much the plan costs"
    // must not mark the fresh pricing goal achieved via the "costs" phrase.
    if (prevStatus !== "achieved" && !goalCancelled && this.state.status !== "cancelled" &&
        this.checkAchieved(this.state.goalType, this.state.slots, lowerText)) {
      this.state.status = "achieved";
      this.state.achievedAt = ts;
      this.state.achievedReason = this.getAchievedReason(this.state.goalType, this.state.slots, lowerText);
      goalAchieved = true;
      console.log(`[GoalEngine] ${this.state.callId} Goal ACHIEVED: ${this.state.goalType} - ${this.state.achievedReason}`);
    } else if (this.state.status !== "achieved" && this.state.status !== "cancelled" && !goalChanged) {
      this.state.status = "in_progress";
    }
    
    this.state.nextBestAction = this.computeNextBestAction();
    
    return {
      state: this.getState(),
      goalChanged,
      goalAchieved,
      goalCancelled,
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
  
  // A confirmation phrase inside a QUESTION is not a confirmation.
  // Real call: owner asked "What should I do the next to the fixed call and
  // text?" — substring "fixed" marked the support goal ACHIEVED and every
  // later hint was hard-stopped. Questions ask for progress; they never
  // confirm it. Negated phrases ("not fixed", "isn't resolved") and future
  // intent ("to fix", "will be fixed" is fine — different phrase) also must
  // not count.
  // Clause-aware: the utterance is split into clauses ("It's fixed now,
  // anything else?" → declarative "It's fixed now" + question "anything
  // else?") and every whole-word occurrence of the phrase is evaluated —
  // it confirms only when it sits in a non-question clause without a
  // preceding negation. "It's not fixed, but it's fixed now" still confirms
  // via the second occurrence.
  private confirmsAchievement(text: string, phrase: string): boolean {
    const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word boundaries only where the phrase starts/ends with a word char
    // (phrases like "it's $" end with a symbol).
    const lead = /^\w/.test(phrase) ? "\\b" : "";
    const trail = /\w$/.test(phrase) ? "\\b" : "";
    const phraseRe = new RegExp(`${lead}${escaped}${trail}`, "gi");

    // Split into clauses on sentence/clause delimiters, keeping the
    // terminator so a clause knows whether it is a question.
    const clauses = text.match(/[^.!?;,]+[.!?;,]?/g) ?? [text];
    for (const clause of clauses) {
      const isQuestionClause = clause.includes("?") || isQuestionOrActionRequest(clause);
      if (isQuestionClause) continue; // questions ask about the goal, never confirm it
      phraseRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = phraseRe.exec(clause)) !== null) {
        // Negation immediately before this occurrence: "not fixed",
        // "isn't resolved", "hasn't been fixed", "never got it done".
        const before = clause.slice(Math.max(0, m.index - 30), m.index);
        const negated = /\b(not|isn't|isnt|wasn't|wasnt|hasn't|hasnt|haven't|havent|never|no)\s+(been\s+|yet\s+|really\s+|quite\s+|got\s+it\s+)?$/i.test(before);
        if (!negated) return true;
      }
    }
    return false;
  }

  checkAchieved(goalType: GoalType, slots: SlotMap, text: string): boolean {
    const requirements = GOAL_REQUIREMENTS[goalType];
    
    for (const phrase of requirements.achievedPhrases) {
      if (this.confirmsAchievement(text, phrase)) {
        return true;
      }
    }
    
    if (requirements.requiredSlots.length > 0) {
      const allSlotsFilled = requirements.requiredSlots.every(slot => slots[slot] !== null);
      // Slot completion is also a hard stop, so a QUESTION turn must not be
      // the one that triggers it ("Would 3 PM on Friday work?" fills date+time
      // but confirms nothing). Slots persist — the next declarative turn will
      // mark the goal achieved.
      if (allSlotsFilled && !isQuestionOrActionRequest(text)) {
        return true;
      }
    }
    
    return false;
  }
  
  getAchievedReason(goalType: GoalType, slots: SlotMap, text: string): string {
    const requirements = GOAL_REQUIREMENTS[goalType];
    
    for (const phrase of requirements.achievedPhrases) {
      if (this.confirmsAchievement(text, phrase)) {
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
    // A cancelled goal must stop steering entirely — no slot-filling nudges
    // toward a goal the owner explicitly abandoned.
    if (this.state.status === "achieved" || this.state.status === "cancelled") {
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
