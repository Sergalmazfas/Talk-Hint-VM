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

const TRAINING_SYSTEM_PROMPT = `You are simulating a phone conversation for training purposes. You play the role of GST (Guest) - the person being called (receptionist, doctor's office, business, etc.). The user (HON - Honor) is practicing making phone calls.

SCENARIO: The user is calling to achieve their stated goal. Play a realistic, slightly challenging but helpful GST character.

IMPORTANT RULES:
1. Respond ONLY in valid JSON format, no extra text
2. Keep GST responses realistic and natural (1-2 sentences in English)
3. The suggestion should help HON achieve their goal (3-7 words, English)
4. Translation is the suggestion in the user's hint language
5. Update goal_state based on conversation progress

OUTPUT FORMAT (strict JSON):
{
  "gst_text": "GST's response in English",
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
}

GST CHARACTER GUIDELINES:
- Be helpful but realistic (ask for details, suggest alternatives)
- Sometimes be slightly busy or need to check things
- Use natural phone conversation phrases
- If appointment/booking: ask for preferred date/time, then confirm
- If pricing: give ranges or ask what service they need
- If support: ask clarifying questions, then provide help`;

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
          { role: "system", content: TRAINING_SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `The user (HON) is about to call to: "${session.goal}". Generate ONLY a brief phone greeting from GST (the person answering). Just the greeting text, no JSON.`
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
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: TRAINING_SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `GOAL: "${session.goal}"
HINT LANGUAGE: ${session.hintLanguage === "ru" ? "Russian" : session.hintLanguage === "es" ? "Spanish" : "Russian"}

CONVERSATION SO FAR:
${historyForPrompt}

Generate the next GST response and a helpful hint for HON. Return ONLY valid JSON.`
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      return { error: "No response from AI" };
    }
    
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseErr) {
      console.error(`[Training] Failed to parse JSON: ${content}`);
      return { 
        error: "Failed to parse AI response",
        gst: { speaker: "GST", text: content.slice(0, 200) }
      };
    }
    
    const gstText = parsed.gst_text || "I understand. How can I help you further?";
    session.history.push({ role: "gst", text: gstText });
    
    if (parsed.goal_state?.slots) {
      for (const [key, value] of Object.entries(parsed.goal_state.slots)) {
        if (value && value !== "null") {
          session.slots[key] = value as string;
        }
      }
    }
    
    console.log(`[Training] Turn processed - GST: "${gstText.slice(0, 50)}..."`);
    
    return {
      hon: { speaker: "HON", text: honText },
      gst: { speaker: "GST", text: gstText },
      hint: {
        suggestion: parsed.suggestion_for_hon || "",
        translation: parsed.translation || "",
        goal_state: {
          current_goal: parsed.goal_state?.current_goal || session.goal,
          next_step: parsed.goal_state?.next_step || "",
          slots: { ...session.slots, ...(parsed.goal_state?.slots || {}) },
          achieved: parsed.goal_state?.achieved || false
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
