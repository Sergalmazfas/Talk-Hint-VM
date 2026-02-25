import crypto from "crypto";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// FAST PROMPTS - ultra-short for speed
const GST_FAST_PROMPT = `You are a phone call partner (receptionist/agent). Reply naturally in English only.

RULES:
- 1-2 sentences max. No teaching.
- If you can answer directly → give the answer
- If you need to check → say what you're checking + give ETA ("Let me check, one moment")
- If you cannot answer → explain limitation + ask for required data OR give next step

NEVER just say "I'll get back to you" without a concrete next action.
If conversation is going in circles, provide a final answer or explain what's needed to proceed.

Return JSON: {"gst_text": "your reply"}`;

// TalkHint copilot prompt - helps HON achieve their goal
// UI shows "You/Guest", internally we use HON/GST
// Translation is display-only, no logic impact
const HINT_FAST_PROMPT = `You are TalkHint — a real-time conversation copilot for live phone calls.

Your role:
- Assist ONLY the Honor (HON = user of TalkHint).
- Never assist the Guest directly.
- Act as a confident consultant/salesperson, not a passive assistant.

PRIMARY GOAL:
Always move the conversation toward the defined goal.
If the goal is not achieved, you must clearly advance the conversation or close it with a next step.
Never leave the conversation hanging.

CORE BEHAVIOR RULES:

1. NEVER LOOP
You are FORBIDDEN to repeat passive phrases like:
"Ok, I'll wait" / "No problem, take your time" / "Sure, let me know"
more than ONCE per Guest delay.
If the Guest delays again ("checking", "one moment", "let me see"),
you MUST push the conversation forward with a steering question.

2. NO DEAD PAUSES
Every suggestion MUST:
- either move toward the goal
- or collect useful information
- or narrow down choices
Silence or waiting without direction is forbidden.

3. ASSERT + STEER (MANDATORY)
Your default response structure: ACKNOWLEDGE → ASSERT → STEER
Examples:
- "Got it. E-Class is usually more budget-friendly. Which one are you leaning toward?"
- "Understood. Most clients choose this option. Do you have a color preference?"

4. ALLOWED ASSUMPTIONS
You ARE allowed to:
- state common market facts
- make reasonable assumptions
- guide without full confirmation
Examples: "E-Class is typically cheaper" / "Most clients prefer this option"

5. SELL, DON'T CLERK
You are NOT a clerk or passive assistant.
You ARE a consultant, salesperson, guide to a decision.
If the Guest hesitates — you LEAD.

6. GOAL ACHIEVEMENT
If goal achieved → mark achieved=true, suggest next goal or end call naturally.
If goal NOT achieved → summarize progress, suggest next concrete step, close without looping.

7. ONE STEERING PER TURN
Never spam multiple questions. One clear steering question per Guest turn.

8. SPEED SAFE
Keep responses short. No long explanations. Natural spoken language only.

9. NO UNFINISHED PHRASES
You are NOT allowed to end a turn with:
"I'll check" / "Let me see" / "I need to verify"
unless you immediately follow with an assertion or a steering question.
If you are unsure what to say:
Default to a clarifying or narrowing question that moves the decision forward.
Never repeat the same steering question twice in a row.
If repeated context occurs, reframe the question.

Return JSON only:
{"suggestion": "short speakable reply", "translation": "same in {LANG}", "achieved": false}`;

// Dialog state tracking - prevents HINT repetition
interface DialogState {
  asked_price: boolean;
  price_known: boolean;
  price_value: string | null;
  asked_types: boolean;
  types_known: boolean;
  asked_availability: boolean;
  availability_known: boolean;
  asked_time: boolean;
  time_known: boolean;
  // Track what GST is currently asking for
  lastGuestRequest: string | null;
  answeredSlots: string[];
  // Goal completion tracking
  goalStatus: "active" | "finished";
  finishReason: "achieved" | "blocked" | null;
  // Intent repeat tracking (anti-loop)
  intentCounts: Record<string, number>;
  // Anti-loop: passive response counter (Task 1)
  passiveResponseCount: number;
  // Anti-loop: last steering question to avoid repeats (Task 2)
  lastSteeringQuestion: string | null;
  // Goal progress: turns since meaningful progress (Task 4)
  turnsSinceProgress: number;
}

function createInitialState(): DialogState {
  return {
    asked_price: false,
    price_known: false,
    price_value: null,
    asked_types: false,
    types_known: false,
    asked_availability: false,
    availability_known: false,
    asked_time: false,
    time_known: false,
    lastGuestRequest: null,
    answeredSlots: [],
    goalStatus: "active",
    finishReason: null,
    intentCounts: {},
    passiveResponseCount: 0,
    lastSteeringQuestion: null,
    turnsSinceProgress: 0
  };
}

// Detect if a response is passive (Task 1: Anti-loop)
function isPassiveResponse(text: string): boolean {
  const lower = text.toLowerCase();
  const passivePhrases = [
    /ok,?\s*(i'll|let me)\s*wait/,
    /no problem,?\s*take your time/,
    /sure,?\s*let me know/,
    /i('ll| will) wait/,
    /take your time/,
    /no rush/,
    /whenever you('re| are) ready/,
    /i('ll| will) hold/,
    /ok,?\s*thank you/,  // Just acknowledgment without steering
  ];
  return passivePhrases.some(p => p.test(lower));
}

// Detect if response contains steering (Task 2: Mandatory Steering)
function containsSteering(text: string): boolean {
  const lower = text.toLowerCase();
  // Check for question marks or steering patterns
  if (text.includes('?')) return true;
  // Assertive steering patterns without questions
  const steeringPatterns = [
    /let('s| us)/,  // "Let's..."
    /i('ll| will) (call|email|send|book|schedule)/,
    /would you (prefer|like)/,
    /most (clients|people) (choose|prefer)/,
    /usually|typically/,  // Making assertions
  ];
  return steeringPatterns.some(p => p.test(lower));
}

// Detect conversation intent for anti-loop tracking
function detectConversationIntent(text: string): string | null {
  const lower = text.toLowerCase();
  
  // Insurance-related intents
  if (/coverage|covered|cover|in.?network|out.?of.?network/.test(lower)) return "insurance_coverage";
  if (/eligibility|eligible|qualify/.test(lower)) return "eligibility";
  if (/copay|co-?pay|deductible|out.?of.?pocket/.test(lower)) return "cost_details";
  if (/pre.?auth|prior.?auth|authorization/.test(lower)) return "prior_auth";
  
  // Medical-related intents
  if (/prescription|refill|medication|rx/.test(lower)) return "prescription";
  if (/appointment|schedule|book|available/.test(lower)) return "appointment";
  if (/test.?result|lab.?result|results/.test(lower)) return "test_results";
  
  // General intents
  if (/price|cost|how much|fee|charge/.test(lower)) return "pricing";
  if (/wait|hold|moment|check|look.?up|let me/.test(lower)) return "waiting";
  if (/call.?back|get.?back|contact.?you/.test(lower)) return "callback";
  
  return null;
}

// Detect what GST is asking for (identification, confirmation, etc.)
function detectGuestRequest(text: string): string | null {
  const lower = text.toLowerCase();
  
  // Identity requests
  if (/your name|what('s| is) your name|may i (have|get) your name|name please/.test(lower)) {
    return "name";
  }
  if (/date of birth|birth date|dob|when were you born|birthday/.test(lower)) {
    return "dob";
  }
  if (/phone number|contact number|can i (have|get) your (phone|number)|number to reach/.test(lower)) {
    return "phone";
  }
  if (/address|where (do you|are you) live|mailing address|street address/.test(lower)) {
    return "address";
  }
  if (/email|e-mail|email address/.test(lower)) {
    return "email";
  }
  
  // Confirmation requests
  if (/is that correct|can you confirm|do i have that right|is this right/.test(lower)) {
    return "confirmation";
  }
  
  // Prescription/medical specific
  if (/prescription|medication|refill|rx number|doctor('s)? name/.test(lower)) {
    return "prescription_info";
  }
  
  // Insurance
  if (/insurance|policy number|member id|group number/.test(lower)) {
    return "insurance";
  }
  
  // Payment
  if (/payment|credit card|card number|billing/.test(lower)) {
    return "payment";
  }
  
  return null;
}

// Intent detection - improved keyword matching for reliability
function detectIntent(text: string, speaker: "hon" | "gst"): string[] {
  const lower = text.toLowerCase();
  const intents: string[] = [];
  
  // Price intents - broader detection
  const priceKeywords = /price|cost|how much|сколько|цена|charge|fee|rate/;
  const priceAnswer = /\$\d+|\d+\s*(dollars?|usd|cents?|bucks?|each|per)|it'?s\s+\d+|costs?\s+\d+|(\d+)\s*(for|a|per)/;
  const numericPrice = /\b\d{1,5}\b/; // Simple numbers like "50", "fifteen"
  
  if (speaker === "hon" && (priceKeywords.test(lower) || /\?.*(?:cost|price|much)/.test(lower))) {
    intents.push("ask_price");
  }
  if (speaker === "gst" && (priceAnswer.test(lower) || (priceKeywords.test(lower) && numericPrice.test(lower)))) {
    intents.push("answer_price");
  }
  
  // Types/options intents - broader detection
  const typesKeywords = /types?|options?|variants?|kinds?|models?|versions?|какие|варианты|choices?|different/;
  const typesAnswer = /we have|there are|offer|come in|available in|include|such as|like the/;
  
  if (speaker === "hon" && typesKeywords.test(lower)) {
    intents.push("ask_types");
  }
  if (speaker === "gst" && (typesAnswer.test(lower) || /\band\b.*\band\b/.test(lower))) {
    // GST listing things (X and Y and Z)
    intents.push("answer_types");
  }
  
  // Availability intents - broader detection
  const availKeywords = /available|in stock|when|schedule|appointment|slots?|opening|book|reserve/;
  const availAnswer = /available|open|free|can (do|schedule|book)|have (a |an )?slot|next available/;
  
  if (speaker === "hon" && availKeywords.test(lower)) {
    intents.push("ask_availability");
  }
  if (speaker === "gst" && availAnswer.test(lower)) {
    intents.push("answer_availability");
  }
  
  // Time intents - broader detection
  const timeKeywords = /what time|when|at \d|time.*\?|schedule/;
  const timeAnswer = /\d+:\d+|\d+\s*(am|pm|a\.m\.|p\.m\.)|o'clock|morning|afternoon|evening|tomorrow|today|monday|tuesday|wednesday|thursday|friday/;
  
  if (speaker === "hon" && timeKeywords.test(lower)) {
    intents.push("ask_time");
  }
  if (speaker === "gst" && timeAnswer.test(lower)) {
    intents.push("answer_time");
  }
  
  return intents;
}

// Update state based on message
function updateDialogState(state: DialogState, text: string, speaker: "hon" | "gst"): DialogState {
  const intents = detectIntent(text, speaker);
  const newState = { 
    ...state, 
    answeredSlots: [...state.answeredSlots],
    intentCounts: { ...state.intentCounts }
  };
  
  // Track conversation intent for anti-loop (both speakers)
  const convIntent = detectConversationIntent(text);
  if (convIntent) {
    newState.intentCounts[convIntent] = (newState.intentCounts[convIntent] || 0) + 1;
  }
  
  // Track what GST is currently asking for
  if (speaker === "gst") {
    const guestRequest = detectGuestRequest(text);
    if (guestRequest) {
      newState.lastGuestRequest = guestRequest;
    }
  }
  
  // If HON responds and there was a pending request, mark it as answered
  if (speaker === "hon" && state.lastGuestRequest) {
    if (!newState.answeredSlots.includes(state.lastGuestRequest)) {
      newState.answeredSlots.push(state.lastGuestRequest);
    }
    newState.lastGuestRequest = null; // Clear after answered
  }
  
  for (const intent of intents) {
    switch (intent) {
      case "ask_price": newState.asked_price = true; break;
      case "answer_price": 
        newState.price_known = true;
        const priceMatch = text.match(/\$(\d+(?:\.\d+)?)/);
        if (priceMatch) newState.price_value = priceMatch[1];
        break;
      case "ask_types": newState.asked_types = true; break;
      case "answer_types": newState.types_known = true; break;
      case "ask_availability": newState.asked_availability = true; break;
      case "answer_availability": newState.availability_known = true; break;
      case "ask_time": newState.asked_time = true; break;
      case "answer_time": newState.time_known = true; break;
    }
  }
  
  return newState;
}

// Generate state context for HINT prompt - includes current request, answered slots, and forbidden intents
function getStateContext(state: DialogState): string {
  const parts: string[] = [];
  
  // TASK 1: Anti-loop - passive response warning
  if (state.passiveResponseCount >= 1) {
    parts.push(`⚠️ PASSIVE BLOCK: You already said a passive phrase (wait/hold). You MUST now STEER or ASSERT. NO MORE: "I'll wait" / "take your time" / "let me know"`);
  }
  
  // TASK 4: Goal progress enforcement (3 turns limit)
  if (state.turnsSinceProgress >= 3) {
    parts.push(`⚠️ STALL ALERT: No progress for ${state.turnsSinceProgress} turns. You MUST: (1) Summarize what's known, (2) Propose next step, OR (3) Close the call.`);
  }
  
  // TASK 2: Last steering question (avoid repeats)
  if (state.lastSteeringQuestion) {
    parts.push(`LAST QUESTION: "${state.lastSteeringQuestion}" - DO NOT repeat this. Reframe or ask something new.`);
  }
  
  // ANTI-LOOP: Check for repeated intents (force resolution)
  const repeatedIntents = Object.entries(state.intentCounts)
    .filter(([_, count]) => count >= 2)
    .map(([intent, count]) => `${intent}(${count}x)`);
  
  if (repeatedIntents.length > 0) {
    parts.push(`⚠️ FORCE RESOLUTION: These topics repeated 2+ times: ${repeatedIntents.join(", ")}. You MUST provide a FINAL answer or mark as BLOCKED. No more "I'll check" or "let me look into it".`);
  }
  
  // Goal status
  if (state.goalStatus === "finished") {
    parts.push(`GOAL STATUS: ${state.finishReason?.toUpperCase() || "FINISHED"}`);
  }
  
  // MOST IMPORTANT: What GST is currently asking for
  if (state.lastGuestRequest) {
    parts.push(`CURRENT GST REQUEST: ${state.lastGuestRequest} - YOU MUST SUGGEST AN ANSWER TO THIS!`);
  }
  
  // Already answered slots (don't ask about these again)
  if (state.answeredSlots.length > 0) {
    parts.push(`ALREADY ANSWERED: ${state.answeredSlots.join(", ")}`);
  }
  
  const known: string[] = [];
  const forbidden: string[] = [];
  
  // Price - forbid if answered OR already asked (waiting for answer)
  if (state.price_known) {
    known.push(`price=${state.price_value || "known"}`);
    forbidden.push("ask_price");
  } else if (state.asked_price) {
    forbidden.push("ask_price (already asked, waiting for answer)");
  }
  
  // Types - forbid if answered OR already asked
  if (state.types_known) {
    known.push("types=known");
    forbidden.push("ask_types");
  } else if (state.asked_types) {
    forbidden.push("ask_types (already asked)");
  }
  
  // Availability - forbid if answered OR already asked
  if (state.availability_known) {
    known.push("availability=known");
    forbidden.push("ask_availability");
  } else if (state.asked_availability) {
    forbidden.push("ask_availability (already asked)");
  }
  
  // Time - forbid if answered OR already asked
  if (state.time_known) {
    known.push("time=known");
    forbidden.push("ask_time");
  } else if (state.asked_time) {
    forbidden.push("ask_time (already asked)");
  }
  
  if (known.length > 0) parts.push(`KNOWN: ${known.join(", ")}`);
  if (forbidden.length > 0) parts.push(`FORBIDDEN: ${forbidden.join(", ")}`);
  
  if (parts.length === 0) return "";
  
  return `\n${parts.join("\n")}`;
}

interface TrainingSession {
  id: string;
  goal: string;
  conversationLanguage: string; // GST speaks this language (always "en")
  hintLanguage: string; // User's native language for translations (ru/es)
  history: Array<{ role: "hon" | "gst"; text: string }>;
  slots: Record<string, string>;
  dialogState: DialogState; // NEW: track what's been asked/answered
  createdAt: Date;
}

const trainingSessions: Map<string, TrainingSession> = new Map();

// GST prompt - ONLY for the conversation partner, NO hints
// {CONVERSATION_LANGUAGE} will be replaced with the actual language
const GST_SYSTEM_PROMPT_TEMPLATE = `You are the conversation partner (GST) in a TalkHint training call.

This is a roleplay phone conversation. The user is practicing a real-life call.
You are NOT an assistant, NOT a coach, NOT a teacher, and NOT ChatGPT.
You are a real person on the phone (doctor, receptionist, support agent, etc.).

You DO NOT know that the user receives hints.
You DO NOT see the goal, slots, or internal state.
You DO NOT explain, teach, or help the user learn.

────────────────────────
LANGUAGE (CRITICAL)
────────────────────────
• You MUST speak ONLY in {CONVERSATION_LANGUAGE}
• Even if the user writes in another language, you ALWAYS reply in {CONVERSATION_LANGUAGE}
• No translations, no mixing languages
• This simulates a real phone call in {CONVERSATION_LANGUAGE}

────────────────────────
ROLE AND BEHAVIOR
────────────────────────
• Speak naturally, like a real person on a phone call
• Use short replies only: 1–2 sentences maximum
• No explanations, no instructions, no lists
• No "as an AI", no system language
• No politeness filler unless natural
• If unsure, say less, not more

────────────────────────
CONVERSATION LOGIC
────────────────────────
• Respond only to the user's last message
• Ask only ONE simple question at a time if information is missing
• If a date is given → ask for time
• If a time is given → confirm or offer an alternative
• If something is unavailable → say it briefly and offer another option
• Keep the initiative with the user; do not decide for them

────────────────────────
GOAL HANDLING
────────────────────────
• Do not complete the goal on your own
• Do not summarize the conversation
• Do not push the user
• Let the conversation progress naturally

────────────────────────
STRICTLY FORBIDDEN
────────────────────────
• Speaking any language other than {CONVERSATION_LANGUAGE}
• Teaching or correcting the user
• Suggesting what the user should say
• Explaining the process
• Mentioning goals, hints, training, AI, or the system
• Speaking more than 2 sentences
• Breaking character

────────────────────────
OUTPUT FORMAT (CRITICAL)
────────────────────────
Return ONLY valid JSON. No extra text. No markdown.

Format:
{
  "gst_text": "Your short reply in {CONVERSATION_LANGUAGE}."
}

FINAL RULE:
If you are unsure, respond with the shortest natural reply possible in {CONVERSATION_LANGUAGE}.`;

function getGstSystemPrompt(conversationLanguage: string): string {
  // Currently only English is supported for GST conversation
  // Force English regardless of input to ensure consistency
  const langName = "English";
  return GST_SYSTEM_PROMPT_TEMPLATE.replace(/\{CONVERSATION_LANGUAGE\}/g, langName);
}

function getConversationLanguageName(lang: string): string {
  return "English"; // Always English for now
}

// Hint prompt - SEPARATE system for generating suggestions
// {HINT_LANGUAGE} will be replaced with the user's native language
const HINT_SYSTEM_PROMPT_TEMPLATE = `You are TalkHint, an AI assistant that helps users during phone calls.
You analyze the conversation and provide helpful suggestions.

Your job:
1. Suggest what the user (HON) should say next to achieve their goal
2. Translate the suggestion into the user's native language ({HINT_LANGUAGE})
3. Track conversation progress (slots filled, goal achieved)
4. Detect if the conversation intent has changed and suggest a new goal if needed

You DO NOT speak in the conversation. You only provide hints.

LANGUAGE RULES:
• "suggestion_for_hon" → ALWAYS in English (the conversation language)
• "translation" → ALWAYS in {HINT_LANGUAGE} (user's native language)
• Never mix languages in a single field

GOAL CHANGE DETECTION:
If you detect the conversation has shifted to a different intent/goal:
• Set "suggested_goal" to the new goal (in English)
• Set "goal_change_reason" to explain why (in English)
• Only suggest if clearly different from current goal

OUTPUT FORMAT (strict JSON):
{
  "suggestion_for_hon": "Short suggestion in English (3-7 words)",
  "translation": "Same suggestion translated to {HINT_LANGUAGE}",
  "goal_state": {
    "current_goal": "user's main goal",
    "next_step": "what HON should do/say next (in English)",
    "slots": {
      "date": "extracted or null",
      "time": "extracted or null",
      "phone": "extracted or null",
      "name": "extracted or null",
      "location": "extracted or null",
      "price": "extracted or null",
      "service": "extracted or null"
    },
    "achieved": false
  },
  "suggested_goal": null,
  "goal_change_reason": null
}`;

function getHintSystemPrompt(hintLanguage: string): string {
  const langName = getHintLanguageName(hintLanguage);
  return HINT_SYSTEM_PROMPT_TEMPLATE.replace(/\{HINT_LANGUAGE\}/g, langName);
}

function getHintLanguageName(lang: string): string {
  if (lang === "es") return "Spanish";
  return "Russian"; // Default to Russian
}

export async function startTrainingSession(
  goal: string,
  conversationLanguage: string = "en", // GST always speaks this (default: English)
  hintLanguage: string = "ru" // User's native language for translations
): Promise<{ 
  sessionId: string; 
  initialHint?: { 
    suggestion: string; 
    translation: string;
    context: string;
  } 
}> {
  const sessionId = crypto.randomUUID();
  
  const session: TrainingSession = {
    id: sessionId,
    goal,
    conversationLanguage,
    hintLanguage,
    history: [],
    slots: {},
    dialogState: createInitialState(),
    createdAt: new Date()
  };
  
  trainingSessions.set(sessionId, session);
  console.log(`[Training] Session started: ${sessionId}, goal: "${goal}"`);
  
  // Generate INITIAL HINT based on goal - what should the user say FIRST
  const initialHint = await generateInitialHint(session);
  
  return { 
    sessionId,
    initialHint
  };
}

// Generate the FIRST hint based on the goal - what should user say to START the conversation
async function generateInitialHint(session: TrainingSession): Promise<{
  suggestion: string;
  translation: string;
  context: string;
} | undefined> {
  if (!OPENAI_API_KEY) {
    return undefined;
  }
  
  try {
    const hintLangName = getHintLanguageName(session.hintLanguage);
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: `You help users practice phone calls in English.
Given the user's goal, generate:
1. An opening phrase in English that the user should say FIRST when the call starts
2. A translation to ${hintLangName}
3. A brief context explanation

Return ONLY valid JSON:
{
  "suggestion": "The opening phrase in English",
  "translation": "Translation to ${hintLangName}",
  "context": "Brief explanation of why to say this"
}`
          },
          { 
            role: "user", 
            content: `User's goal: "${session.goal}"

Generate an appropriate opening phrase for this phone call. The user is MAKING the call, not receiving it.`
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      })
    });
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (content) {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log(`[Training] Initial hint: "${parsed.suggestion}"`);
          return {
            suggestion: parsed.suggestion || "",
            translation: parsed.translation || "",
            context: parsed.context || ""
          };
        }
      } catch {
        console.error("[Training] Failed to parse initial hint JSON");
      }
    }
    
    return undefined;
  } catch (err: any) {
    console.error(`[Training] Error generating initial hint: ${err.message}`);
    return undefined;
  }
}

async function generateInitialGstGreeting(session: TrainingSession): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.error("[Training] No OPENAI_API_KEY configured");
    return "Hello, how can I help you today?";
  }
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: getGstSystemPrompt(session.conversationLanguage) },
          { 
            role: "user", 
            content: `Generate ONLY a brief phone greeting in English. Just the greeting text, no JSON. Example: "Hello, Dr. Smith's office, how may I help you?"`
          }
        ],
        temperature: 0.7,
        max_tokens: 100
      })
    });
    
    const data = await response.json();
    let greeting = data.choices?.[0]?.message?.content?.trim() || "Hello, how can I help you?";
    
    // Parse JSON if returned (sometimes GPT returns JSON even when asked not to)
    if (greeting.includes('{') && greeting.includes('}')) {
      try {
        const jsonMatch = greeting.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          greeting = parsed.gst_text || parsed.text || parsed.greeting || greeting;
        }
      } catch {
        // Not valid JSON, use as-is
      }
    }
    
    // Remove quotes if wrapped
    greeting = greeting.replace(/^["']|["']$/g, '');
    
    session.history.push({ role: "gst", text: greeting });
    console.log(`[Training] Initial GST greeting: "${greeting}"`);
    
    return greeting;
  } catch (err: any) {
    console.error(`[Training] Error generating greeting: ${err.message}`);
    return "Hello, how can I help you today?";
  }
}

export async function processTrainingTurn(
  sessionId: string,
  honText: string,
  goalOverride?: string
): Promise<{
  error?: string;
  hon?: { speaker: string; text: string };
  gst?: { speaker: string; text: string };
  hint?: {
    suggestion: string;
    translation: string;
    goal_state: {
      current_goal: string;
      next_step: string;
      slots: Record<string, string | null>;
      achieved: boolean;
    };
  };
  suggested_goal?: {
    goal: string;
    reason: string;
  };
  timing?: {
    total_ms: number;
    gst_ms: number;
    hint_ms: number;
  };
}> {
  const startTime = Date.now();
  const session = trainingSessions.get(sessionId);
  
  if (!session) {
    return { error: "Session not found" };
  }
  
  if (goalOverride) {
    session.goal = goalOverride;
  }
  
  session.history.push({ role: "hon", text: honText });
  
  // Update dialog state based on HON message
  session.dialogState = updateDialogState(session.dialogState, honText, "hon");
  
  if (!OPENAI_API_KEY) {
    return { error: "OpenAI API key not configured" };
  }
  
  try {
    // OPTIMIZATION: Trim context to last 3 exchanges (6 messages)
    const recentHistory = session.history.slice(-6);
    const historyForPrompt = recentHistory.map(h => 
      `${h.role.toUpperCase()}: ${h.text}`
    ).join("\n");
    
    // STEP 1: Call GST first (we need to know what they ask before generating HINT)
    const gstStartTime = Date.now();
    
    const gstResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: GST_FAST_PROMPT },
          { role: "user", content: historyForPrompt }
        ],
        temperature: 0.6,
        max_tokens: 80
      })
    });
    
    const gstMs = Date.now() - gstStartTime;
    const gstData = await gstResponse.json();
    const gstContent = gstData.choices?.[0]?.message?.content?.trim();
    
    let gstText = "I understand. How can I help you?";
    if (gstContent) {
      try {
        const jsonMatch = gstContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const gstParsed = JSON.parse(jsonMatch[0]);
          gstText = gstParsed.gst_text || gstParsed.text || gstText;
        } else {
          gstText = gstContent.replace(/^["']|["']$/g, '').slice(0, 150);
        }
      } catch {
        gstText = gstContent.replace(/^["']|["']$/g, '').slice(0, 150);
      }
    }
    
    session.history.push({ role: "gst", text: gstText });
    
    // STEP 2: Update dialog state based on GST response (BEFORE calling HINT)
    session.dialogState = updateDialogState(session.dialogState, gstText, "gst");
    
    console.log(`[Training] GST (${gstMs}ms): "${gstText}"`);
    console.log(`[Training] State: lastGuestRequest=${session.dialogState.lastGuestRequest}, answered=${session.dialogState.answeredSlots.join(",")}`);
    
    // Get state context for HINT (now includes what GST just asked)
    const stateContext = getStateContext(session.dialogState);
    
    // Add GST's latest message to history for HINT
    const historyWithGst = historyForPrompt + `\nGST: ${gstText}`;
    
    // STEP 3: Run translation AND hint in PARALLEL (hint now knows what GST asked)
    const langName = getHintLanguageName(session.hintLanguage);
    const hintStartTime = Date.now();
    
    const [translateResult, hintResponse] = await Promise.all([
      // Translation call
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: `Translate to ${langName}. Return ONLY the translation.` },
            { role: "user", content: gstText }
          ],
          temperature: 0.3,
          max_tokens: 80
        })
      }).then(r => r.json()).catch(() => null),
      // Hint call (now has GST's message in context)
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: HINT_FAST_PROMPT.replace("{LANG}", getHintLanguageName(session.hintLanguage)) },
            { role: "user", content: `Goal: ${session.goal}${stateContext}\n\n${historyWithGst}` }
          ],
          temperature: 0.6,
          max_tokens: 120
        })
      })
    ]);
    
    const hintData = await hintResponse.json();
    
    let gstTranslation = "";
    if (translateResult?.choices?.[0]?.message?.content) {
      gstTranslation = translateResult.choices[0].message.content.trim();
      console.log(`[Training] GST translation: "${gstTranslation}"`);
    }
    
    const hintMs = Date.now() - hintStartTime;
    const hintContent = hintData.choices?.[0]?.message?.content?.trim();
    
    let hint = {
      suggestion: "",
      translation: "",
      goal_state: {
        current_goal: session.goal,
        next_step: "",
        slots: session.slots as Record<string, string | null>,
        achieved: false
      }
    };
    
    if (hintContent) {
      try {
        const jsonMatch = hintContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const hintParsed = JSON.parse(jsonMatch[0]);
          // Support both old and new format
          hint.suggestion = hintParsed.suggestion || hintParsed.suggestion_for_hon || "";
          hint.translation = hintParsed.translation || "";
          hint.goal_state.achieved = hintParsed.achieved || false;
        }
      } catch (err) {
        console.error(`[Training] Failed to parse hint JSON: ${hintContent}`);
      }
    }
    
    const totalMs = Date.now() - startTime;
    console.log(`[Training] Hint (${hintMs}ms): "${hint.suggestion}" | achieved=${hint.goal_state.achieved} | Total: ${totalMs}ms`);
    
    // TASK 1 & 2: Check if hint has steering content
    const hasSteering = hint.suggestion && containsSteering(hint.suggestion);
    const isPassive = hint.suggestion && isPassiveResponse(hint.suggestion);
    
    // TASK 1: Track passive responses - only reset when we get steering
    if (isPassive) {
      session.dialogState.passiveResponseCount++;
      console.log(`[Training] Passive response detected (count: ${session.dialogState.passiveResponseCount})`);
    } else if (hasSteering) {
      // Only reset when we actually have steering content
      session.dialogState.passiveResponseCount = 0;
    }
    // If neither passive nor steering, keep counter as-is
    
    // TASK 2: Track last steering question (avoid repeats)
    if (hasSteering) {
      const question = hint.suggestion.match(/[^.!?]*\?/)?.[0] || hint.suggestion;
      session.dialogState.lastSteeringQuestion = question;
    }
    
    // TASK 2: Mandatory steering enforcement - add fallback question if no steering
    if (hint.suggestion && !hasSteering && !isPassive && !hint.goal_state.achieved) {
      // Append a steering question based on goal context
      const fallbackQuestions = [
        "What works best for you?",
        "Would you prefer to schedule now?",
        "Can we confirm the details?",
        "What's your preference?"
      ];
      const fallback = fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
      hint.suggestion = hint.suggestion + " " + fallback;
      console.log(`[Training] Added fallback steering: "${fallback}"`);
    }
    
    // TASK 6: Determine response type for UI
    let responseType: "HOLD" | "STEER" | "CLOSE" = "STEER";
    if (hint.goal_state.achieved) {
      responseType = "CLOSE";
    } else if (isPassive) {
      responseType = "HOLD";
    } else if (hasSteering || hint.suggestion?.includes("?")) {
      responseType = "STEER";
    }
    
    // TASK 4: Track turns since progress (delta-based)
    const prevSlotCount = session.dialogState.answeredSlots.length;
    const prevPriceKnown = session.dialogState.price_known;
    // Progress = new slot answered OR goal achieved this turn
    const hasNewProgress = hint.goal_state.achieved;
    if (hasNewProgress) {
      session.dialogState.turnsSinceProgress = 0;
    } else {
      session.dialogState.turnsSinceProgress++;
    }
    
    // Update session goalStatus if achieved
    if (hint.goal_state.achieved) {
      session.dialogState.goalStatus = "finished";
      session.dialogState.finishReason = "achieved";
      console.log(`[Training] Goal ACHIEVED for session ${sessionId}`);
    }
    
    const result: any = {
      hon: { speaker: "HON", text: honText },
      gst: { speaker: "GST", text: gstText, translation: gstTranslation },
      hint: {
        suggestion: hint.suggestion,
        translation: hint.translation,
        responseType: responseType, // TASK 6: UI label
        goal_state: {
          current_goal: session.goal,
          next_step: hint.suggestion,
          slots: session.slots,
          achieved: hint.goal_state.achieved,
          status: session.dialogState.goalStatus,
          finishReason: session.dialogState.finishReason
        }
      },
      timing: {
        total_ms: totalMs,
        gst_ms: gstMs,
        hint_ms: hintMs
      }
    };
    
    return result;
  } catch (err: any) {
    console.error(`[Training] Error in turn: ${err.message}`);
    return { error: err.message };
  }
}

export function resetTrainingSession(sessionId: string): boolean {
  const session = trainingSessions.get(sessionId);
  if (session) {
    session.history = [];
    session.slots = {};
    console.log(`[Training] Session reset: ${sessionId}`);
    return true;
  }
  return false;
}

export function deleteTrainingSession(sessionId: string): boolean {
  return trainingSessions.delete(sessionId);
}

setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;
  
  const entries = Array.from(trainingSessions.entries());
  for (const [id, session] of entries) {
    if (now - session.createdAt.getTime() > maxAge) {
      trainingSessions.delete(id);
      console.log(`[Training] Session expired: ${id}`);
    }
  }
}, 5 * 60 * 1000);

// ElevenLabs TTS
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Voice IDs - can be customized
const VOICE_GST = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" - neutral female voice for Guest
const VOICE_HINT = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" - clear coach voice for Hints

export async function generateTTS(
  text: string,
  voiceType: "gst" | "hint" = "gst"
): Promise<Buffer | null> {
  if (!ELEVENLABS_API_KEY) {
    console.error("[TTS] No ELEVENLABS_API_KEY configured");
    return null;
  }
  
  const voiceId = voiceType === "hint" ? VOICE_HINT : VOICE_GST;
  
  try {
    console.log(`[TTS] Generating audio for: "${text.substring(0, 50)}..." (voice: ${voiceType})`);
    
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: voiceType === "hint" ? 0.75 : 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TTS] ElevenLabs error: ${response.status} - ${errorText}`);
      return null;
    }
    
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`[TTS] Generated ${audioBuffer.length} bytes of audio`);
    
    return audioBuffer;
  } catch (err: any) {
    console.error(`[TTS] Error: ${err.message}`);
    return null;
  }
}
