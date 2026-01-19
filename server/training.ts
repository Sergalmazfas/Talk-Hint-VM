import crypto from "crypto";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface TrainingSession {
  id: string;
  goal: string;
  conversationLanguage: string; // GST speaks this language (always "en")
  hintLanguage: string; // User's native language for translations (ru/es)
  history: Array<{ role: "hon" | "gst"; text: string }>;
  slots: Record<string, string>;
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
}> {
  const session = trainingSessions.get(sessionId);
  
  if (!session) {
    return { error: "Session not found" };
  }
  
  if (goalOverride) {
    session.goal = goalOverride;
  }
  
  session.history.push({ role: "hon", text: honText });
  
  if (!OPENAI_API_KEY) {
    return { error: "OpenAI API key not configured" };
  }
  
  try {
    const historyForPrompt = session.history.map(h => 
      `${h.role.toUpperCase()}: ${h.text}`
    ).join("\n");
    
    // STEP 1: Get GST response (separate call, no goal knowledge)
    const gstResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `CONVERSATION:\n${historyForPrompt}\n\nRespond as GST in English only. Return ONLY valid JSON.`
          }
        ],
        temperature: 0.7,
        max_tokens: 150
      })
    });
    
    const gstData = await gstResponse.json();
    const gstContent = gstData.choices?.[0]?.message?.content?.trim();
    
    let gstText = "I understand. How can I help you?";
    if (gstContent) {
      try {
        const jsonMatch = gstContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const gstParsed = JSON.parse(jsonMatch[0]);
          gstText = gstParsed.gst_text || gstText;
        }
      } catch {
        // If not JSON, use raw text (fallback)
        gstText = gstContent.replace(/^["']|["']$/g, '').slice(0, 200);
      }
    }
    
    session.history.push({ role: "gst", text: gstText });
    console.log(`[Training] GST: "${gstText}"`);
    
    // STEP 2: Get hint (separate call, knows the goal)
    const hintResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: getHintSystemPrompt(session.hintLanguage) },
          { 
            role: "user", 
            content: `GOAL: "${session.goal}"

CONVERSATION:
${historyForPrompt}
GST: ${gstText}

What should HON say next in English? Translate the suggestion to ${getHintLanguageName(session.hintLanguage)}. Return ONLY valid JSON.`
          }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });
    
    const hintData = await hintResponse.json();
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
    
    let suggestedGoal: { goal: string; reason: string } | undefined = undefined;
    
    if (hintContent) {
      try {
        const jsonMatch = hintContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const hintParsed = JSON.parse(jsonMatch[0]);
          hint.suggestion = hintParsed.suggestion_for_hon || "";
          hint.translation = hintParsed.translation || "";
          if (hintParsed.goal_state) {
            hint.goal_state = {
              current_goal: hintParsed.goal_state.current_goal || session.goal,
              next_step: hintParsed.goal_state.next_step || "",
              slots: { ...session.slots, ...(hintParsed.goal_state.slots || {}) },
              achieved: hintParsed.goal_state.achieved || false
            };
            // Update session slots
            if (hintParsed.goal_state.slots) {
              for (const [key, value] of Object.entries(hintParsed.goal_state.slots)) {
                if (value && value !== "null") {
                  session.slots[key] = value as string;
                }
              }
            }
          }
          
          // Check for suggested goal change
          if (hintParsed.suggested_goal && hintParsed.goal_change_reason) {
            suggestedGoal = {
              goal: hintParsed.suggested_goal,
              reason: hintParsed.goal_change_reason
            };
            console.log(`[Training] Suggested new goal: "${suggestedGoal.goal}" - ${suggestedGoal.reason}`);
          }
        }
      } catch (err) {
        console.error(`[Training] Failed to parse hint JSON: ${hintContent}`);
      }
    }
    
    console.log(`[Training] Hint: "${hint.suggestion}"`);
    
    const result: any = {
      hon: { speaker: "HON", text: honText },
      gst: { speaker: "GST", text: gstText },
      hint: {
        suggestion: hint.suggestion,
        translation: hint.translation,
        goal_state: {
          current_goal: hint.goal_state.current_goal,
          next_step: hint.goal_state.next_step,
          slots: hint.goal_state.slots,
          achieved: hint.goal_state.achieved
        }
      }
    };
    
    if (suggestedGoal) {
      result.suggested_goal = suggestedGoal;
    }
    
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
