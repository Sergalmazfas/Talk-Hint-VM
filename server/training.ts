import crypto from "crypto";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface TrainingSession {
  id: string;
  goal: string;
  language: string;
  hintLanguage: string;
  history: Array<{ role: "hon" | "gst"; text: string }>;
  slots: Record<string, string>;
  createdAt: Date;
}

const trainingSessions: Map<string, TrainingSession> = new Map();

// GST prompt - ONLY for the conversation partner, NO hints
const GST_SYSTEM_PROMPT = `You are the conversation partner (GST) in a TalkHint training call.

This is a roleplay phone conversation. The user is practicing a real-life call.
You are NOT an assistant, NOT a coach, NOT a teacher, and NOT ChatGPT.
You are a real person on the phone (doctor, receptionist, support agent, etc.).

You DO NOT know that the user receives hints.
You DO NOT see the goal, slots, or internal state.
You DO NOT explain, teach, or help the user learn.

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
  "gst_text": "Your short reply as the conversation partner."
}

FINAL RULE:
If you are unsure, respond with the shortest natural reply possible.`;

// Hint prompt - SEPARATE system for generating suggestions
const HINT_SYSTEM_PROMPT = `You are TalkHint, an AI assistant that helps users during phone calls.
You analyze the conversation and provide helpful suggestions.

Your job:
1. Suggest what the user (HON) should say next to achieve their goal
2. Translate the suggestion into the user's native language
3. Track conversation progress (slots filled, goal achieved)

You DO NOT speak in the conversation. You only provide hints.

OUTPUT FORMAT (strict JSON):
{
  "suggestion_for_hon": "Short suggestion in English (3-7 words)",
  "translation": "Suggestion translated to hint language",
  "goal_state": {
    "current_goal": "user's main goal",
    "next_step": "what HON should do/say next",
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
  }
}`;

export async function startTrainingSession(
  goal: string,
  language: string,
  hintLanguage: string
): Promise<{ sessionId: string; gst?: { text: string } }> {
  const sessionId = crypto.randomUUID();
  
  const session: TrainingSession = {
    id: sessionId,
    goal,
    language,
    hintLanguage,
    history: [],
    slots: {},
    createdAt: new Date()
  };
  
  trainingSessions.set(sessionId, session);
  console.log(`[Training] Session started: ${sessionId}, goal: "${goal}"`);
  
  const initialGst = await generateInitialGstGreeting(session);
  
  return { 
    sessionId,
    gst: initialGst ? { text: initialGst } : undefined
  };
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
          { role: "system", content: GST_SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `Generate ONLY a brief phone greeting. Just the greeting text, no JSON. Example: "Hello, Dr. Smith's office, how may I help you?"`
          }
        ],
        temperature: 0.7,
        max_tokens: 100
      })
    });
    
    const data = await response.json();
    const greeting = data.choices?.[0]?.message?.content?.trim() || "Hello, how can I help you?";
    
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
          { role: "system", content: GST_SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `CONVERSATION:\n${historyForPrompt}\n\nRespond as GST. Return ONLY valid JSON.`
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
          { role: "system", content: HINT_SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `GOAL: "${session.goal}"
HINT LANGUAGE: ${session.hintLanguage === "ru" ? "Russian" : session.hintLanguage === "es" ? "Spanish" : "Russian"}

CONVERSATION:
${historyForPrompt}
GST: ${gstText}

What should HON say next? Return ONLY valid JSON.`
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
        }
      } catch (err) {
        console.error(`[Training] Failed to parse hint JSON: ${hintContent}`);
      }
    }
    
    console.log(`[Training] Hint: "${hint.suggestion}"`);
    
    return {
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
