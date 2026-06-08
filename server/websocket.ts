import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES, MODE_PROMPTS, getModePrompt, getFullPrompt, LIVE_ANTI_LOOP_RULES } from "@shared/prompts";
import { FastLayerManager, FastPhraseResult, FAST_THRESHOLD_MS, FAST_COOLDOWN_MS } from "./fastLayer";
import { getOrCreateEngine, removeEngine, GoalEngine } from "./goalEngine";
import { UtteranceGate } from "./utteranceGate";
import { getSessionUserId } from "./auth";
import { db } from "./db";
import { pendingCalls } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { GoalState, SlotMap } from "../shared/goalTypes";

// μ-law to linear PCM16 conversion table (8kHz μ-law to 16-bit PCM)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function initMulawTable() {
  for (let i = 0; i < 256; i++) {
    const mulaw = ~i;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
  }
})();

// Convert μ-law buffer to PCM16 and upsample 8kHz to 24kHz (3x)
function mulawToPcm16(mulawBase64: string): string {
  const mulawBytes = Buffer.from(mulawBase64, "base64");
  // Upsample 8kHz to 24kHz (3x replication for simplicity)
  const pcm16Buffer = Buffer.alloc(mulawBytes.length * 2 * 3);
  
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = MULAW_DECODE_TABLE[mulawBytes[i]];
    // Replicate each sample 3 times for 8kHz -> 24kHz
    for (let j = 0; j < 3; j++) {
      const offset = (i * 3 + j) * 2;
      pcm16Buffer.writeInt16LE(sample, offset);
    }
  }
  
  return pcm16Buffer.toString("base64");
}

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

const MODES: Record<string, { name: string; description: string }> = {
  universal: { name: "Universal Assistant", description: "General purpose real-time assistant" },
  massage: { name: "Massage Salon Assistant", description: "Helps massage therapists communicate with clients" },
  dispatcher: { name: "Dispatcher Assistant", description: "Helps dispatchers handle calls efficiently" },
};

// Re-export prompts from centralized location
export { TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES } from "@shared/prompts";

// Analyze sentiment of text
async function analyzeSentiment(text: string): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; score: number }> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Analyze the emotional tone/sentiment of the text. Return JSON only:
{"sentiment": "positive" | "neutral" | "negative", "score": 0.0 to 1.0}
Score: 1.0 = very strong emotion, 0.0 = neutral. Be concise.`
          },
          { role: "user", content: text }
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!response.ok) return { sentiment: 'neutral', score: 0.5 };
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sentiment: parsed.sentiment || 'neutral',
        score: typeof parsed.score === 'number' ? parsed.score : 0.5
      };
    }
    return { sentiment: 'neutral', score: 0.5 };
  } catch (err) {
    return { sentiment: 'neutral', score: 0.5 };
  }
}

// Translate guest speech and generate suggestion
const PREAMBLE_PATTERNS = [
  /^(i understand|i see|i hear you|i get it|that makes sense)[,.]?\s*/i,
  /^(of course|certainly|absolutely|sure)[,.]?\s*/i,
  /^(great|perfect|wonderful|excellent|awesome)[,!.]?\s*/i,
  /^(let me|allow me|let's)[^.!?]*[,.]?\s*/i,
  /^(okay|ok|alright)[,.]?\s*/i,
];
function stripPreamble(text: string): string {
  let result = text.trim();
  for (const pattern of PREAMBLE_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

// Model used for live hint generation (translation + suggestion).
// Override the default without a code change via the HINT_MODEL env var.
const HINT_MODEL = process.env.HINT_MODEL || "gpt-4.1-mini";
// Models the user is allowed to pick from the settings UI.
const ALLOWED_HINT_MODELS = ["gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini", "gpt-4o"];
// Active model — global (single-user app), changeable at runtime via set_model.
let currentModel = ALLOWED_HINT_MODELS.includes(HINT_MODEL) ? HINT_MODEL : "gpt-4.1-mini";

async function translateAndSuggest(text: string, goal: string, language: string = "ru", conversationContext: string = ""): Promise<{
  translation: string;
  explanation?: string;
  suggestion?: { en: string; translation: string };
  sentiment?: { sentiment: 'positive' | 'neutral' | 'negative'; score: number };
}> {
  const langName = LANGUAGE_NAMES[language] || "Russian";
  const langCode = language === "es" ? "ES" : "RU";
  
  // Don't wait for sentiment - return it separately via callback
  // This makes suggestions appear FASTER
  try {
    const contextSection = conversationContext 
      ? `\n\nCONVERSATION HISTORY:\n${conversationContext}\n` 
      : "";
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: currentModel,
        messages: [
          {
            role: "system",
            content: `You help user during phone calls. User's goal: ${goal || "Have a successful conversation"}. User speaks ${langName}.${contextSection}

This is a LIVE call. Help the user move toward the call goal. Correctness over speed — if unsure, stay silent.

${LIVE_ANTI_LOOP_RULES}

Guest just spoke. 
1) Translate guest's words to ${langName}. 
2) Suggest what user should say next - a short reply IN ENGLISH (under 15 words) that moves toward the goal.
3) Translate that suggestion to ${langName}.
4) Classify guest sentiment in one word: positive | neutral | negative | urgent | confused.

Return JSON only, no markdown:
{"translation":"guest's words in ${langName}",
 "suggestion":{"en":"reply in ENGLISH","translation":"same reply in ${langName}"},
 "sentiment":"positive|neutral|negative|urgent|confused"}`
          },
          {
            role: "user",
            content: `Guest said: "${text}"

Remember: Your suggestion must ADVANCE the user's goal. If guest said "let me check" or similar - just acknowledge once, don't push with new questions.`
          }
        ],
        temperature: 0.4,
        max_tokens: 80
      }),
    });

    if (!response.ok) {
      throw new Error(`GPT API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON response - return immediately without waiting for sentiment
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const sentimentRaw = typeof parsed.sentiment === "string" ? parsed.sentiment.toLowerCase().trim() : "";
      const validSentiment = ["positive", "neutral", "negative"].includes(sentimentRaw)
        ? (sentimentRaw as "positive" | "neutral" | "negative")
        : (sentimentRaw === "urgent" || sentimentRaw === "confused")
          ? "negative"
          : undefined;
      let suggestion = parsed.suggestion || undefined;
      if (suggestion) {
        suggestion = {
          ...suggestion,
          en: typeof suggestion.en === "string" ? stripPreamble(suggestion.en) : suggestion.en,
          translation: typeof suggestion.translation === "string" ? stripPreamble(suggestion.translation) : suggestion.translation,
        };
      }
      return {
        translation: parsed.translation || "",
        explanation: parsed.explanation || undefined,
        suggestion,
        sentiment: validSentiment ? { sentiment: validSentiment, score: 1 } : undefined,
      };
    }
    
    return { translation: "" };
  } catch (err: any) {
    log(`Translation error: ${err.message}`, "openai");
    return { translation: "" };
  }
}

// Use getModePrompt from shared/prompts.ts instead of local PROMPTS
function getRealtimePrompt(mode: string = "universal"): string {
  return getModePrompt(mode);
}

let currentMode = "universal";
let currentLanguage = "ru"; // Default to Russian, can be "ru" or "es"
const uiClients = new Set<WebSocket>();
// Each /ui (and /honor-stream) socket is bound to the user it authenticated as,
// so live transcripts/hints are delivered only to that user — never broadcast
// to every connected client.
const uiClientUsers = new Map<WebSocket, string>();
// callSid -> owning userId. Populated when a call is accepted so the Twilio
// media stream can route its transcripts/suggestions to the right user.
const callOwners = new Map<string, string>();

/** Records which user owns a call (called from the /api/call/accept route). */
export function setCallOwner(callSid: string, userId: string) {
  callOwners.set(callSid, userId);
}

/** Forgets a call's owner (call ended / rejected). */
export function clearCallOwner(callSid: string) {
  callOwners.delete(callSid);
}

// Filter JSON from text - never show raw JSON to users
function filterJsonFromText(text: string): string {
  if (!text) return text;
  
  // Remove JSON blocks like {...} or [{...}]
  let filtered = text.replace(/\{[\s\S]*?\}/g, '').replace(/\[[\s\S]*?\]/g, '');
  
  // Clean up leftover formatting
  filtered = filtered.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  filtered = filtered.trim();
  
  // If nothing left after filtering, extract useful fields from original
  if (!filtered && text.includes('{')) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Extract common fields
        const parts: string[] = [];
        if (parsed.suggestion) parts.push(parsed.suggestion);
        if (parsed.en || parsed.english) parts.push(parsed.en || parsed.english);
        if (parsed.translation || parsed.ru) parts.push(parsed.translation || parsed.ru);
        if (parsed.text) parts.push(parsed.text);
        filtered = parts.join('\n\n') || "Готово";
      }
    } catch {}
  }
  
  return filtered || text;
}

// Delivers a message only to the connected /ui sockets belonging to `userId`.
// Fails closed: if the owning user is unknown, the message is dropped rather
// than leaked to other users' clients.
function sendToUser(userId: string | undefined, message: object) {
  if (!userId) {
    log(`[sendToUser] No owner for ${(message as any).type} - dropping (fail-closed)`, "server");
    return;
  }
  const data = JSON.stringify(message);
  let sent = 0;
  uiClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && uiClientUsers.get(client) === userId) {
      client.send(data);
      sent++;
    }
  });
  log(`[sendToUser] ${(message as any).type} -> ${sent} client(s) for user ${userId}`, "server");
}

// No audio conversion needed - OpenAI accepts mulaw (pcmu) directly from Twilio

class GPTRealtimeHandler {
  private apiKey: string;
  private mode: string;
  private ws: WebSocket | null = null;
  private isConnected = false;
  private sessionId: string | null = null;
  private onTranscript: (data: { role: string; text: string }) => void;
  private onResponse: (data: { type: string; text: string }) => void;
  private onAudio: (data: string) => void;
  private onError: (error: any) => void;

  constructor(options: {
    apiKey?: string;
    mode?: string;
    onTranscript?: (data: { role: string; text: string }) => void;
    onResponse?: (data: { type: string; text: string }) => void;
    onAudio?: (data: string) => void;
    onError?: (error: any) => void;
  }) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.mode = options.mode || "universal";
    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onError = options.onError || (() => {});
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      this.ws.on("open", () => {
        log("Connected to OpenAI Realtime API", "openai");
        this.isConnected = true;
        this.initSession();
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(JSON.parse(data.toString()));
      });

      this.ws.on("error", (err: Error) => {
        log(`OpenAI WebSocket error: ${err.message}`, "openai");
        this.onError(err);
        reject(err);
      });

      this.ws.on("close", () => {
        log("OpenAI WebSocket closed", "openai");
        this.isConnected = false;
      });
    });
  }

  private initSession() {
    // FROZEN: Always use base prompt (TALKHINT_GOLDEN_PROMPT)
    // Custom prompts (activePromptId from phone_numbers) are NOT used for Basic plan
    // This is intentional - all users get the same base AI assistant behavior
    const fullInstructions = `${TALKHINT_GOLDEN_PROMPT}\n\n${getRealtimePrompt(this.mode)}`;
    
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: fullInstructions,
        voice: "alloy",
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.3,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    });
  }

  private send(message: object) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private audioChunkCount = 0;
  private totalAudioSent = 0;
  
  sendAudio(base64Audio: string) {
    if (!this.isConnected || !this.ws) {
      return; // Not connected yet
    }
    
    // Send μ-law audio directly to OpenAI (native g711_ulaw support)
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Audio }));
    this.audioChunkCount++;
    this.totalAudioSent++;
    
    // Log first audio and periodically
    if (this.totalAudioSent === 1) {
      log(`First audio chunk sent to OpenAI (g711_ulaw, ${base64Audio.length} bytes)`, "openai");
    }
  }
  
  commitAudio() {
    // With server_vad, OpenAI automatically detects speech end
    // Manual commit not needed
    if (this.totalAudioSent > 0) {
      log(`Total audio chunks sent: ${this.totalAudioSent}`, "openai");
    }
  }

  private handleMessage(message: any) {
    // Log all OpenAI messages for debugging (including content for transcript events)
    if (message.type) {
      if (message.type.includes("transcript")) {
        log(`OpenAI event: ${message.type} - ${JSON.stringify(message).slice(0, 200)}`, "openai");
      } else if (!message.type.includes("audio.delta")) {
        log(`OpenAI event: ${message.type}`, "openai");
      }
    }
    
    switch (message.type) {
      case "session.created":
        this.sessionId = message.session?.id;
        log(`Session created: ${this.sessionId}`, "openai");
        break;
      case "session.updated":
        log(`Session updated successfully`, "openai");
        break;
      case "input_audio_buffer.speech_started":
        log(`Speech detected`, "openai");
        break;
      case "input_audio_buffer.speech_stopped":
        log(`Speech ended`, "openai");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (message.transcript) {
          log(`Guest: ${message.transcript}`, "transcript");
          this.onTranscript({ role: "guest", text: message.transcript });
        }
        break;
      case "response.audio_transcript.delta":
        if (message.delta) {
          this.onResponse({ type: "transcript_delta", text: message.delta });
        }
        break;
      case "response.audio_transcript.done":
        if (message.transcript) {
          log(`Assistant: ${message.transcript}`, "transcript");
          this.onTranscript({ role: "assistant", text: message.transcript });
        }
        break;
      case "response.audio.delta":
        if (message.delta) {
          this.onAudio(message.delta);
        }
        break;
      case "conversation.item.input_audio_transcription.failed":
        log(`Transcription failed: ${JSON.stringify(message.error)}`, "openai");
        break;
      case "error":
        log(`OpenAI API Error: ${JSON.stringify(message.error)}`, "openai");
        this.onError(message.error);
        break;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const parsedUrl = new URL(request.url || "", `http://${request.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (!["/twilio-stream", "/media", "/honor-stream", "/ui"].includes(pathname)) {
      socket.destroy();
      return;
    }

    // Client-facing channels (the iOS in-call screen and the browser UI) carry
    // live call transcripts and AI hints, so they MUST authenticate as a user.
    // The Twilio media channels (/twilio-stream, /media) are machine-to-machine
    // from Twilio and are not user-authenticated here.
    const requiresAuth = pathname === "/ui" || pathname === "/honor-stream";
    if (requiresAuth) {
      const token = parsedUrl.searchParams.get("token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      getSessionUserId(token)
        .then((userId) => {
          if (!userId) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request, pathname, userId);
          });
        })
        .catch(() => {
          socket.destroy();
        });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, pathname);
    });
  });

  wss.on("connection", (ws: WebSocket, request: any, pathname: string, userId?: string) => {
    if (pathname === "/ui") {
      handleUIConnection(ws, userId);
    } else if (pathname === "/honor-stream") {
      handleHonorStream(ws, userId);
    } else if (pathname === "/twilio-stream" || pathname === "/media") {
      log(`Twilio Media Stream connected via ${pathname}`, "twilio");
      handleTwilioStream(ws);
    }
  });

  let currentGoal = "";
  
  async function handleAIQuestion(ws: WebSocket, question: string, goal: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      ws.send(JSON.stringify({ type: "ai_response", text: "API ключ не настроен", error: true }));
      return;
    }

    try {
      const langName = LANGUAGE_NAMES[currentLanguage] || "Russian";
      const goalLockInstructions = goal ? `
GOAL LOCK-IN MODE: The user has set a clear goal: "${goal}"
- ONLY provide phrases and help that move toward this goal
- IGNORE small-talk or off-topic requests from the caller
- Keep steering toward: confirming time, place, details for the goal
- If user asks for a phrase, give ONE clear phrase that advances the goal` : '';
      
      const systemPrompt = `${TALKHINT_GOLDEN_PROMPT}

The user's goal for this call: ${goal || "Not specified"}
The user's native language: ${langName}
${goalLockInstructions}

The user is asking you a question during an active phone call.
Respond with a SHORT, helpful answer.
If they need a phrase to say, give them the English phrase AND its translation to ${langName}.
NEVER output JSON - only plain text with the phrase and translation.`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question }
          ],
          max_tokens: 200
        })
      });

      const data = await response.json() as any;
      let text = data.choices?.[0]?.message?.content || "Не удалось получить ответ";
      
      // Filter out JSON from response - never show raw JSON to user
      text = filterJsonFromText(text);
      
      ws.send(JSON.stringify({ type: "ai_response", text }));
      log(`AI response sent: ${text.substring(0, 50)}...`, "server");
    } catch (err: any) {
      log(`AI question error: ${err.message}`, "server");
      ws.send(JSON.stringify({ type: "ai_response", text: "Ошибка при обработке вопроса", error: true }));
    }
  }
  
  function handleUIConnection(ws: WebSocket, userId?: string) {
    log(`UI client connected (user ${userId})`, "server");
    uiClients.add(ws);
    if (userId) uiClientUsers.set(ws, userId);

    ws.send(JSON.stringify({ type: "connected", timestamp: Date.now(), goal: currentGoal, model: currentModel }));

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "set_mode") {
          currentMode = message.mode;
          log(`Mode changed to: ${currentMode}`, "server");
          ws.send(JSON.stringify({ type: "mode_changed", mode: currentMode }));
        } else if (message.type === "update_goal" || message.type === "set_goal") {
          currentGoal = message.goal || "";
          log(`Goal set: ${currentGoal.substring(0, 50)}...`, "server");
          ws.send(JSON.stringify({ type: "goal_set", goal: currentGoal }));
        } else if (message.type === "set_language") {
          const lang = message.language;
          if (lang === "ru" || lang === "es") {
            currentLanguage = lang;
            log(`Language changed to: ${currentLanguage}`, "server");
            ws.send(JSON.stringify({ type: "language_changed", language: currentLanguage }));
          }
        } else if (message.type === "set_model") {
          const model = message.model;
          if (ALLOWED_HINT_MODELS.includes(model)) {
            currentModel = model;
            log(`Hint model changed to: ${currentModel}`, "server");
            ws.send(JSON.stringify({ type: "model_changed", model: currentModel }));
          } else {
            log(`Rejected unknown hint model: ${model}`, "server");
            ws.send(JSON.stringify({ type: "model_changed", model: currentModel }));
          }
        } else if (message.type === "ask_ai") {
          const question = message.question || "";
          const goal = message.goal || currentGoal;
          log(`AI question: ${question.substring(0, 50)}...`, "server");
          handleAIQuestion(ws, question, goal);
        }
      } catch (err) {}
    });

    ws.on("close", () => {
      log("UI client disconnected", "server");
      uiClients.delete(ws);
      uiClientUsers.delete(ws);
    });
  }

  function handleHonorStream(ws: WebSocket, userId?: string) {
    log("Browser mic connected", "honor");
    let gptHandler: GPTRealtimeHandler | null = null;
    let sessionId: string | null = null;
    // Route this honor session's transcripts/responses only to its owner.
    const uiBroadcast = (message: object) => sendToUser(userId, message);

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "start":
            sessionId = message.sessionId || Date.now().toString(36);
            log(`Honor session started: ${sessionId}`, "honor");

            gptHandler = new GPTRealtimeHandler({
              mode: currentMode,
              onTranscript: (transcript) => {
                ws.send(JSON.stringify({ type: "transcript", sessionId, ...transcript }));
                uiBroadcast({ type: "hon_transcript", sessionId, ...transcript });
              },
              onResponse: (response) => {
                const { type: respType, ...rest } = response;
                ws.send(JSON.stringify({ type: "response", sessionId, responseType: respType, ...rest }));
                uiBroadcast({ type: "hon_response", sessionId, responseType: respType, ...rest });
              },
              onAudio: (audio) => {
                ws.send(JSON.stringify({ type: "audio", audio }));
              },
              onError: (error) => {
                ws.send(JSON.stringify({ type: "error", error: error.message || error }));
              },
            });

            await gptHandler.connect();
            ws.send(JSON.stringify({ type: "ready", sessionId }));
            break;

          case "audio":
            if (gptHandler && message.audio) {
              gptHandler.sendAudio(message.audio);
            }
            break;

          case "stop":
            log(`Honor session ended: ${sessionId}`, "honor");
            if (gptHandler) {
              gptHandler.commitAudio(); // Flush remaining audio
              gptHandler.disconnect();
            }
            ws.send(JSON.stringify({ type: "stopped", sessionId }));
            break;
        }
      } catch (err: any) {
        log(`Honor error: ${err.message}`, "honor");
      }
    });

    ws.on("close", () => {
      if (gptHandler) gptHandler.disconnect();
    });
  }

  function handleTwilioStream(ws: WebSocket) {
    const startTime = new Date().toISOString();
    log(`[TwilioStream] Connected at ${startTime}`, "twilio");
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let streamUserId: string | undefined; // Owner of this call (set on "start" from callOwners)
    let audioFrameCount = 0;
    let isPstnForwarding = false; // PSTN forwarding mode - roles are inverted
    // True when the media stream rides the CALLER's leg (incoming answered call /
    // iOS conference bridge). On that leg inbound = caller (GUEST) and outbound =
    // bridged agent (OWNER) — i.e. mirror of a browser outbound call.
    let streamOnCallerLeg = false;
    // Route this call's transcripts/suggestions only to the owning user's UI clients.
    const uiBroadcast = (message: object) => sendToUser(streamUserId, message);
    let goalEngine: GoalEngine | null = null; // Goal State Engine per call
    let deepgramReady = false; // Flag to track if Deepgram is ready
    const audioBuffer: { track: string; data: Buffer }[] = []; // Buffer for early audio
    
    // Hint throttling - prevents spam of suggestions
    let lastHintTs = 0;                    // Timestamp of last hint shown
    let lastHintUtteranceId = -1;          // Utterance ID of last hint
    let goalAchievedFlag = false;          // HARD STOP when goal is achieved
    const HINT_COOLDOWN_MS = 1500;         // Block second hint for 1.5 sec
    
    // Anti-loop guards - prevents cycling on same emotions/suggestions
    let lastSuggestionIntent = "";         // Last intent type (enthusiasm/ask_date/etc)
    let lastSuggestionText = "";           // Last suggestion text for duplicate check
    const recentSuggestions: string[] = []; // Last few suggestions for duplicate window
    const RECENT_SUGGESTIONS_MAX = 4;      // How many past suggestions to compare against
    const DUPLICATE_SIMILARITY = 0.8;      // Block if >=80% similar to any recent suggestion

    // Anti-echo (cross-track) - same speech transcribed on BOTH tracks (mic/speaker bleed)
    const recentUtterances: { speaker: "GST" | "HON"; norm: string; ts: number }[] = [];
    const ECHO_WINDOW_MS = 1200;           // Window to treat opposite-track repeat as echo (acoustic bleed is near-instant)
    const ECHO_SIMILARITY = 0.85;          // Similarity threshold to call it an echo (high, to spare legit turn-taking)
    
    // Wait State - when GST says "let me check", block STEER until new content
    let waitingForInfo = false;            // True when GST is checking/looking
    let waitAckShown = false;              // True after showing 1 ACK ("Sure, I'll wait")
    let waitingSlot: string | null = null; // Which slot we're waiting for
    
    // Patterns that trigger Wait State
    const WAIT_PATTERNS = /\b(let me check|one moment|hold on|just a (second|moment|sec)|give me a (second|moment|sec|minute)|looking into|checking|i'?ll look|let me see|let me look|please hold|bear with me|i need to check|i'?ll find out|let me find|looking it up)\b/i;
    
    // Patterns that EXIT Wait State (GST has real answer)
    const EXIT_WAIT_PATTERNS = /\b(found it|here'?s|the answer|i found|that would be|it'?s|costs?|price is|\$\d|percent|per hour|starting at|minimum|maximum|we have|we offer|we can|available|not available|yes we|no we|unfortunately|actually)\b/i;
    
    // Reaction-only phrases to filter (short emotional reactions with no info)
    const REACTION_ONLY_PATTERNS = [
      /^(that'?s?\s+)?(good|great|amazing|awesome|perfect|wonderful|fantastic|excellent|nice|cool|fine)\.?$/i,
      /^(oh\s+)?(my\s+)?(god|gosh|wow|man|boy)\.?$/i,
      /^(ok(ay)?|right|sure|alright|got\s+it|i\s+see|uh[\s-]?huh)\.?$/i,
      /^(yeah|yep|yup|nope|nah)\.?$/i,
      /^hmm+\.?$/i,
      /^(let'?s?\s+go|let'?s?\s+do\s+(it|this|that))\.?$/i,
      /^i understand(\.)?$/i,
      /^i understand you(\.)?$/i,
      /^understood(\.)?$/i,
    ];
    
    // Farewell / closing phrases - conversation is wrapping up, no steer needed (translation still shown)
    const FAREWELL_PATTERNS = /\b(see you|talk to you|speak (to|with) you|catch you|bye|goodbye|good bye|take care|have a (good|great|nice)|thanks?( so much| a lot)?|thank you|appreciate it|see ya|until (then|monday|tomorrow|next)|looking forward)\b/i;

    // Keywords that indicate meaningful content (don't block)
    const MEANINGFUL_KEYWORDS = /\b(yes|no|when|where|what|how|price|cost|time|date|day|week|month|hour|minute|dollar|euro|available|book|schedule|appointment|cancel|change|confirm|sure|alright|definitely|absolutely|of course|please|thank|sounds good|deal|agreed|perfect|let me|i need|i want|i would|i will|can i|could you)\b/i;
    
    // Intent patterns for repeat detection
    const INTENT_PATTERNS: { pattern: RegExp; intent: string }[] = [
      { pattern: /can'?t wait|excited|amazing|wonderful|great|let'?s go|sounds good/i, intent: "enthusiasm" },
      { pattern: /when|what (day|date|time)/i, intent: "ask_date" },
      { pattern: /what time|which hour/i, intent: "ask_time" },
      { pattern: /how long|duration/i, intent: "ask_duration" },
      { pattern: /where|location|address/i, intent: "ask_location" },
      { pattern: /price|cost|budget|how much/i, intent: "ask_price" },
      { pattern: /confirm|all set|done|complete/i, intent: "closing" }
    ];
    
    function detectIntent(text: string): string {
      for (const { pattern, intent } of INTENT_PATTERNS) {
        if (pattern.test(text)) return intent;
      }
      return "general";
    }
    
    function isReactionOnly(text: string): boolean {
      const trimmed = text.trim();
      const wordCount = trimmed.split(/\s+/).length;
      
      // If has meaningful keywords, not reaction-only
      if (MEANINGFUL_KEYWORDS.test(trimmed)) return false;
      
      // If more than 5 words, likely has content
      if (wordCount > 5) return false;
      
      // Check against reaction patterns
      for (const pattern of REACTION_ONLY_PATTERNS) {
        if (pattern.test(trimmed)) return true;
      }
      
      // Short phrase without info (< 4 words, no keywords)
      if (wordCount <= 3 && !MEANINGFUL_KEYWORDS.test(trimmed)) {
        return true;
      }
      
      return false;
    }
    
    function normalizeText(text: string): string {
      return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    }
    
    function textSimilarity(a: string, b: string): number {
      const na = normalizeText(a);
      const nb = normalizeText(b);
      if (na === nb) return 1;
      if (!na || !nb) return 0;
      
      const wordsA = na.split(' ');
      const wordsB = nb.split(' ');
      const setB = new Set(wordsB);
      const intersection = wordsA.filter(w => setB.has(w)).length;
      const allWords = new Set(wordsA.concat(wordsB));
      const union = allWords.size;
      return intersection / union; // Jaccard similarity
    }
    
    // Twilio WS keepalive ping every 15 seconds to prevent proxy/edge idle disconnect
    const twilioKeepaliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // Twilio expects JSON messages, send a heartbeat
        ws.ping();
        log(`[Twilio] keepalive ping sent`, "twilio");
      }
    }, 15000);
    
    // Conversation history for context
    const conversationLog: { speaker: string; text: string; timestamp: number }[] = [];
    
    // Utterance Gate - wait for end of speech before generating hints
    const utteranceGate = new UtteranceGate(async (speaker, text, utteranceId, confidence) => {
      // ===== ANTI-ECHO: drop the same speech echoed onto the opposite track =====
      // On speakerphone the mic captures the remote audio (and vice versa), so the
      // same words get transcribed on BOTH Deepgram tracks. Keep the first, drop the echo.
      const norm = normalizeText(text);
      const nowTs = Date.now();
      // prune old entries
      while (recentUtterances.length && nowTs - recentUtterances[0].ts > ECHO_WINDOW_MS) {
        recentUtterances.shift();
      }
      if (norm) {
        const echo = recentUtterances.find(
          (u) => u.speaker !== speaker && textSimilarity(norm, u.norm) >= ECHO_SIMILARITY
        );
        if (echo) {
          log(`[BLOCKED] reason=echo speaker=${speaker} text="${text.substring(0, 30)}" - mirrored on ${echo.speaker} track`, "websocket");
          return;
        }
        recentUtterances.push({ speaker, norm, ts: nowTs });
      }

      if (speaker === "GST") {
        await handleGuestUtteranceComplete(text, utteranceId, confidence);
      } else {
        handleOwnerUtteranceComplete(text, utteranceId, confidence);
      }
    });
    
    // Handler for complete GST utterance (after debounce)
    async function handleGuestUtteranceComplete(text: string, utteranceId: number, confidence?: number) {
      log(`[UtteranceComplete] GST utterance #${utteranceId}: "${text.substring(0, 50)}..."`, "websocket");
      
      const now = Date.now();
      
      // ALWAYS add to conversation log (even if hints are blocked)
      conversationLog.push({
        speaker: "Guest",
        text: text,
        timestamp: now
      });
      if (conversationLog.length > 10) conversationLog.shift();
      
      // ALWAYS update GoalEngine (even if hints are blocked)
      let goalJustAchieved = false;
      if (goalEngine) {
        const goalUpdate = goalEngine.updateOnUtterance({
          speaker: "GST",
          text: text,
          ts: now
        });
        
        const state = goalUpdate.state;
        const missingSlot = state.missingSlots[0] || "none";
        fastLayer.setGoal(state.goalType, missingSlot);
        
        uiBroadcast({
          type: "goal_state_update",
          target: "HON",
          callId: state.callId,
          goalType: state.goalType,
          currentGoal: state.currentGoal,
          confidence: state.confidence,
          status: state.status,
          slots: state.slots,
          missingSlots: state.missingSlots,
          nextBestAction: state.nextBestAction
        });
        
        if (goalUpdate.goalAchieved) {
          goalAchievedFlag = true;
          goalJustAchieved = true;
          log(`[GoalAchieved] HARD STOP activated - no more hints after this`, "goal");
          uiBroadcast({
            type: "goal_achieved",
            target: "HON",
            callId: state.callId,
            goalType: state.goalType,
            summary: state.currentGoal,
            achievedReason: state.achievedReason
          });
        }
        
        log(`[GoalEngine] GST update: goal=${state.goalType}, status=${state.status}, missing=${state.missingSlots.join(",")}`, "goal");
      }
      
      // ===== WAIT STATE DETECTION =====
      // Check if GST says "let me check" / "one moment" → enter wait state
      if (WAIT_PATTERNS.test(text)) {
        waitingForInfo = true;
        log(`[WAIT_STATE] Entered - GST says "${text.substring(0, 40)}"`, "websocket");
      }
      
      // Check if GST gives actual answer → exit wait state
      if (waitingForInfo && EXIT_WAIT_PATTERNS.test(text)) {
        waitingForInfo = false;
        waitAckShown = false; // Reset ACK for next wait
        waitingSlot = null;
        log(`[WAIT_STATE] Exited - GST answered "${text.substring(0, 40)}"`, "websocket");
      }
      
      // ===== ANTI-LOOP GUARD: Reaction-only filter =====
      // For reaction-only phrases: still get translation, but skip suggestion
      const reactionOnly = isReactionOnly(text);
      if (reactionOnly && !goalJustAchieved) {
        log(`[REACTION_ONLY] text="${text.substring(0, 30)}" - will translate but skip suggestion`, "websocket");
      }
      // Farewell / closing phrases: conversation is wrapping up, no steer needed.
      // Guard against false positives like "Thanks, what time works best?" - if the
      // utterance asks a question or has an actionable scheduling keyword, it's NOT a farewell.
      const isFarewell =
        FAREWELL_PATTERNS.test(text) &&
        !/\?/.test(text) &&
        !/\b(when|what time|which|how|can you|could you|would you|book|schedule|reschedule|change|cancel|available|price|cost)\b/i.test(text);
      if (isFarewell && !goalJustAchieved) {
        log(`[FAREWELL] text="${text.substring(0, 30)}" - will translate but skip suggestion`, "websocket");
      }
      
      // ALWAYS get translation for guest transcript
      fastLayer.setLanguage(currentLanguage);
      // fastLayer.onGstUtteranceEnd(); // Fast Layer disabled — silence while GPT thinks is better than an irrelevant filler
      
      const contextHistory = conversationLog.map(m => `${m.speaker}: ${m.text}`).join("\n");
      const gptStart = Date.now();
      const translated = await translateAndSuggest(text, currentGoal, currentLanguage, contextHistory);
      const gptMs = Date.now() - gptStart;
      log(`[TIMING] model=${currentModel} gpt=${gptMs}ms utteranceId=${utteranceId}`, "websocket");
      
      fastLayer.onGptResponseReceived();
      
      // ALWAYS broadcast translation (even if suggestion is blocked)
      uiBroadcast({ 
        type: "guest_transcript",
        text: text,
        translation: translated.translation,
        isFinal: true,
        isComplete: true,
        confidence,
        utteranceId,
        callSid
      });
      // Reaction time for the caption (it shows even when the suggestion is blocked).
      // `now` is captured at handler entry ≈ Deepgram EndOfTurn (commitTurn fires this synchronously).
      log(`[TIMING] reaction end_of_turn->caption=${Date.now() - now}ms (gpt=${gptMs}ms) utteranceId=${utteranceId}`, "websocket");
      
      // ===== HINT THROTTLING CHECKS (only for suggestions, not transcripts) =====
      
      // If goal just achieved on this utterance - send closing phrase, skip regular hint
      if (goalJustAchieved) {
        uiBroadcast({
          type: "suggestion",
          target: "HON",
          eventType: "closing",
          source: "system",
          basedOnSpeaker: "GST",
          en: "All set! Thanks for the call.",
          translation: currentLanguage === "ru" ? "Готово! Спасибо за звонок." : "¡Todo listo! Gracias por la llamada.",
          utteranceId,
          callSid
        });
        lastHintTs = Date.now();
        lastHintUtteranceId = utteranceId;
        log(`[Suggestion] Closing phrase sent, goal achieved`, "websocket");
        return;
      }
      
      // Check 1: HARD STOP if goal was achieved earlier
      if (goalAchievedFlag) {
        log(`[BLOCKED] reason=goal_achieved utteranceId=${utteranceId} - no hint`, "websocket");
        return;
      }
      
      // Check 2: 1 hint = 1 utterance (same utterance already got a hint)
      if (utteranceId === lastHintUtteranceId) {
        log(`[BLOCKED] reason=hint_shown utteranceId=${utteranceId} - already hinted`, "websocket");
        return;
      }
      
      // Check 3: Cooldown after previous hint
      const timeSinceLastHint = now - lastHintTs;
      if (lastHintTs > 0 && timeSinceLastHint < HINT_COOLDOWN_MS) {
        log(`[BLOCKED] reason=cooldown utteranceId=${utteranceId} elapsed=${timeSinceLastHint}ms`, "websocket");
        return;
      }
      
      // ===== END THROTTLING CHECKS =====
      
      // Check: reaction-only filter (skip suggestion, but translation was shown above)
      if (reactionOnly && !goalJustAchieved) {
        log(`[BLOCKED] reason=reaction_only text="${text.substring(0, 30)}" - suggestion skipped`, "websocket");
        return;
      }

      // Check: farewell filter (skip suggestion, but translation was shown above)
      if (isFarewell && !goalJustAchieved) {
        log(`[BLOCKED] reason=farewell text="${text.substring(0, 30)}" - suggestion skipped`, "websocket");
        return;
      }
      
      // ===== WAIT STATE: Show 1 ACK, then block STEER =====
      if (waitingForInfo && !goalJustAchieved) {
        if (!waitAckShown) {
          // Show 1 ACK response
          waitAckShown = true;
          const ackPhrases = {
            ru: { en: "Sure, I'll wait.", translation: "Конечно, подожду." },
            es: { en: "Sure, I'll wait.", translation: "Claro, esperaré." }
          };
          const ack = ackPhrases[currentLanguage as "ru" | "es"] || ackPhrases.ru;
          
          uiBroadcast({
            type: "suggestion",
            target: "HON",
            eventType: "ack",
            source: "wait_state",
            basedOnSpeaker: "GST",
            en: ack.en,
            translation: ack.translation,
            utteranceId,
            callSid
          });
          lastHintTs = Date.now();
          lastHintUtteranceId = utteranceId;
          log(`[WAIT_STATE] ACK shown - "Sure, I'll wait." - now blocking STEER`, "websocket");
          return;
        } else {
          // ACK already shown, block all further STEER until exit
          log(`[BLOCKED] reason=wait_state - GST is checking, waiting for answer`, "websocket");
          return;
        }
      }
      
      if (translated.suggestion) {
        const suggestionText = translated.suggestion.en;
        
        // ===== ANTI-LOOP GUARD: Repeat intent check =====
        const currentIntent = detectIntent(suggestionText);
        if (currentIntent === lastSuggestionIntent && currentIntent === "enthusiasm") {
          log(`[BLOCKED] reason=repeat_intent intent=${currentIntent} - skipping enthusiasm loop`, "websocket");
          // Don't show repeated enthusiasm, but record that we tried
          lastSuggestionIntent = currentIntent;
          return;
        }
        
        // ===== ANTI-LOOP GUARD: Duplicate suggestion check (window of recent hints) =====
        let maxSim = 0;
        for (const prev of recentSuggestions) {
          const sim = textSimilarity(suggestionText, prev);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim >= DUPLICATE_SIMILARITY) {
          log(`[BLOCKED] reason=duplicate_suggestion similarity=${(maxSim * 100).toFixed(0)}% - too similar to a recent hint`, "websocket");
          return;
        }

        // Final re-check: goal may have been achieved while GPT was generating (async race)
        if (goalAchievedFlag) {
          log(`[BLOCKED] reason=goal_achieved (post-generation) utteranceId=${utteranceId} - no hint`, "websocket");
          return;
        }
        
        // Record hint shown for throttling
        lastHintTs = Date.now();
        lastHintUtteranceId = utteranceId;
        lastSuggestionIntent = currentIntent;
        lastSuggestionText = suggestionText;
        recentSuggestions.push(suggestionText);
        if (recentSuggestions.length > RECENT_SUGGESTIONS_MAX) recentSuggestions.shift();
        
        log(`[Suggestion] Sending to HON, basedOn=GST, utteranceId=${utteranceId}, intent=${currentIntent}`, "websocket");
        uiBroadcast({
          type: "suggestion",
          target: "HON",
          eventType: "suggestion",
          source: "gpt",
          basedOnSpeaker: "GST",
          en: translated.suggestion.en,
          translation: translated.suggestion.translation,
          utteranceId,
          callSid
        });
        // Full reaction time: from end of guest's turn to the suggestion leaving the server.
        log(`[TIMING] reaction end_of_turn->suggestion=${Date.now() - now}ms (gpt=${gptMs}ms) utteranceId=${utteranceId}`, "websocket");
      }
    }
    
    // Handler for complete HON utterance (after debounce)
    function handleOwnerUtteranceComplete(text: string, utteranceId: number, confidence?: number) {
      log(`[UtteranceComplete] HON utterance #${utteranceId}: "${text.substring(0, 50)}..."`, "websocket");
      
      // Add to conversation log
      conversationLog.push({
        speaker: "Honor",
        text: text,
        timestamp: Date.now()
      });
      if (conversationLog.length > 10) conversationLog.shift();
      
      // Update GoalEngine
      if (goalEngine) {
        const goalUpdate = goalEngine.updateOnUtterance({
          speaker: "HON",
          text: text,
          ts: Date.now()
        });
        
        const state = goalUpdate.state;
        
        uiBroadcast({
          type: "goal_state_update",
          target: "HON",
          callId: state.callId,
          goalType: state.goalType,
          currentGoal: state.currentGoal,
          confidence: state.confidence,
          status: state.status,
          slots: state.slots,
          missingSlots: state.missingSlots,
          nextBestAction: state.nextBestAction
        });
        
        if (goalUpdate.goalAchieved) {
          goalAchievedFlag = true; // HARD STOP: goal can be achieved on the owner's reply too
          log(`[GoalAchieved] HARD STOP activated (on HON utterance) - no more hints`, "goal");
          uiBroadcast({
            type: "goal_achieved",
            target: "HON",
            callId: state.callId,
            goalType: state.goalType,
            summary: state.currentGoal,
            achievedReason: state.achievedReason
          });
        }
        
        log(`[GoalEngine] HON update: goal=${state.goalType}, status=${state.status}, slots=${JSON.stringify(goalUpdate.newSlots)}`, "goal");
      }
      
      uiBroadcast({ 
        type: "owner_transcript",
        text: text,
        isFinal: true,
        isComplete: true,
        confidence,
        utteranceId,
        callSid
      });
    }
    
    // Fast Layer for quick responses while GPT is thinking
    const fastLayer = new FastLayerManager((phrase: FastPhraseResult, waitTimeMs: number) => {
      log(`[FastLayer] Emitting fast_phrase after ${waitTimeMs}ms: "${phrase.text}" (${phrase.category})`, "fast");
      
      // Notify GoalEngine about fast phrase to prevent steer repetition
      if (goalEngine) {
        goalEngine.onFastPhraseSent(phrase.category, phrase.slot !== "none" ? phrase.slot : undefined);
      }
      
      uiBroadcast({
        type: "fast_phrase",
        text: phrase.text,
        translation: phrase.translation,
        category: phrase.category,
        target: "HON",
        timestamp: Date.now(),
        waitTimeMs,
        goalType: phrase.goalType,
        slot: phrase.slot
      });
    });
    
    // Deepgram connections for each track
    let deepgramInbound: any = null;
    let deepgramOutbound: any = null;
    
    // Create Deepgram client
    const dgApiKey = process.env.DEEPGRAM_API_KEY || "";
    log(`[Deepgram] API Key present: ${dgApiKey ? 'YES (' + dgApiKey.substring(0, 8) + '...)' : 'NO'}`, "deepgram");
    const deepgramClient = createClient(dgApiKey);
    
    // Setup Deepgram live transcription for a track using raw WebSocket
    // With keepalive and reconnect support
    function setupDeepgram(track: string, onReconnect?: () => void) {
      log(`[DG] ${track}: connecting...`, "deepgram");
      
      // Use raw WebSocket for more control.
      // Deepgram Flux (v2): conversational STT with model-native turn detection.
      // It emits TurnInfo events (StartOfTurn/Update/EndOfTurn) instead of
      // is_final/speech_final + VAD, so end-of-turn is decided by meaning/intonation.
      // mulaw @ 8kHz is supported natively (Twilio's format) — no transcoding.
      // eager mode is OFF (no eager_eot_threshold) — EndOfTurn-only pipeline.
      const dgUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=mulaw&sample_rate=8000&eot_threshold=0.7&eot_timeout_ms=3000";
      
      let keepaliveInterval: NodeJS.Timeout | null = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 3;
      let isClosedIntentionally = false;
      
      const dgWs = new WebSocket(dgUrl, {
        headers: {
          "Authorization": `Token ${dgApiKey}`
        }
      });
      
      // Wrapper to match SDK interface
      const connection = {
        send: (data: Buffer) => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
          }
        },
        finish: () => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
          }
        },
        on: (event: string, handler: any) => {
          // Map to raw WebSocket events
        }
      };
      
      dgWs.on("open", () => {
        log(`[DG] ${track}: open`, "deepgram");
        reconnectAttempts = 0;
        // Flux has a server-side watchdog (it injects silence on gaps), so no
        // manual KeepAlive ping is needed — and v2 ignores the v1 KeepAlive msg.
      });
      
      dgWs.on("message", async (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          
          // Flux (v2) speaks in TurnInfo events instead of is_final/VAD.
          if (response.type !== "TurnInfo") {
            // Connected / Metadata / Error etc. — log and ignore.
            if (response.type === "Error" || response.type === "Warning") {
              log(`[DG] ${track}: ${response.type} - ${response.description || response.message || JSON.stringify(response)}`, "deepgram");
            }
            return;
          }
          
          const event: string = response.event; // StartOfTurn | Update | EndOfTurn
          const transcript: string = (response.transcript || "").trim();
          
          // Track mapping (CORRECTED):
          // Twilio Media Streams: inbound = audio INTO Twilio, outbound = audio OUT OF Twilio.
          // Owner-leg stream (browser outbound call): inbound=HON (browser mic), outbound=GST (remote PSTN).
          // Caller-leg stream (incoming answered: browser <Dial><Client> AND iOS conference bridge):
          //   the stream rides the caller's leg, so inbound=GST (caller), outbound=HON (bridged agent).
          //   This is the mirror of the owner-leg case and is what fixes iOS CALLER/YOU being swapped.
          const isGuestTrack = streamOnCallerLeg ? (track === "inbound") : (track === "outbound");
          const isOwnerTrack = streamOnCallerLeg ? (track === "outbound") : (track === "inbound");
          const speakerLabel = isOwnerTrack ? "Owner" : "Guest";
          const speakerCode = isGuestTrack ? "GST" : "HON";
          
          if (event === "StartOfTurn") {
            log(`[DG] ${track}: StartOfTurn speaker=${speakerLabel}`, "deepgram");
            return;
          }
          
          if (!transcript) {
            return;
          }
          
          if (event === "Update") {
            // Interim turn-in-progress text — show live, do not run the pipeline.
            if (isGuestTrack) {
              uiBroadcast({ type: "guest_transcript", text: transcript, isFinal: false, callSid });
            } else {
              uiBroadcast({ type: "owner_transcript", text: transcript, isFinal: false, callSid });
            }
            return;
          }
          
          if (event === "EndOfTurn") {
            const eotConf = response.end_of_turn_confidence;
            log(`[TrackDebug] track=${track}, callerLeg=${streamOnCallerLeg}, isPstn=${isPstnForwarding}, isGuest=${isGuestTrack}, speaker=${speakerLabel} event=EndOfTurn conf=${eotConf}`, "deepgram");
            
            // Show the completed turn text immediately as interim. The canonical
            // FINAL (guest carries translation; owner carries isComplete) is emitted
            // once by handle{Guest,Owner}UtteranceComplete via onGenerate below —
            // marking this isFinal would double-fire the same final to UI consumers.
            if (isGuestTrack) {
              uiBroadcast({ type: "guest_transcript", text: transcript, isFinal: false, callSid });
            } else {
              uiBroadcast({ type: "owner_transcript", text: transcript, isFinal: false, callSid });
            }
            
            // Commit the completed turn → runs translation/hint pipeline via onGenerate.
            utteranceGate.commitTurn(callSid || "unknown", speakerCode as "GST" | "HON", transcript, eotConf);
          }
        } catch (err: any) {
          log(`[Deepgram] Parse error: ${err.message}`, "deepgram");
        }
      });
      
      dgWs.on("error", (err: any) => {
        log(`[DG] ${track}: error - ${err.message}`, "deepgram");
      });
      
      dgWs.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason?.toString() || "no reason";
        log(`[DG] ${track}: closed code=${code} reason=${reasonStr}`, "deepgram");
        
        // Clear keepalive interval
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = null;
        }
        
        // Auto-reconnect if not intentionally closed
        if (!isClosedIntentionally && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const backoffMs = Math.pow(2, reconnectAttempts) * 1000;
          log(`[DG] ${track}: reconnect attempt #${reconnectAttempts} backoff=${backoffMs}ms`, "deepgram");
          setTimeout(() => {
            if (onReconnect) {
              onReconnect();
              log(`[DG] ${track}: reconnected`, "deepgram");
            }
          }, backoffMs); // Exponential backoff: 2s, 4s, 8s
        }
      });
      
      return { 
        dgWs, 
        send: (data: Buffer) => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(data);
          }
        }, 
        finish: () => {
          isClosedIntentionally = true;
          if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = null;
          }
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.close();
          }
        }
      };
    }

    ws.on("message", (data: Buffer) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        
        if (message.event !== "media") {
          log(`Twilio event: ${message.event}`, "twilio");
        }

        switch (message.event) {
          case "connected":
            log("Twilio Media Stream handshake", "twilio");
            // Pre-initialize Deepgram immediately on connected to capture early audio
            log("[DG] Pre-initializing on connected event", "deepgram");
            
            let inboundReady = false;
            let outboundReady = false;
            
            const checkBothReady = () => {
              if (inboundReady && outboundReady && !deepgramReady) {
                deepgramReady = true;
                log("[DG] Both connections ready, flushing buffer", "deepgram");
                
                // Flush any buffered audio
                if (audioBuffer.length > 0) {
                  const bufferedMs = Math.round(audioBuffer.length * 20);
                  log(`[AUDIO] flush buffered ${bufferedMs}ms (${audioBuffer.length} frames)`, "twilio");
                  for (const frame of audioBuffer) {
                    if (frame.track === "inbound" && deepgramInbound) {
                      deepgramInbound.send(frame.data);
                    } else if (frame.track === "outbound" && deepgramOutbound) {
                      deepgramOutbound.send(frame.data);
                    }
                  }
                  audioBuffer.length = 0;
                }
              }
            };
            
            const setupInboundEarly = () => {
              const dg = setupDeepgram("inbound", setupInboundEarly);
              deepgramInbound = dg;
              // Wait for actual WebSocket open
              if (dg.dgWs) {
                dg.dgWs.on("open", () => {
                  inboundReady = true;
                  log("[DG] inbound WebSocket opened", "deepgram");
                  checkBothReady();
                });
              }
            };
            const setupOutboundEarly = () => {
              const dg = setupDeepgram("outbound", setupOutboundEarly);
              deepgramOutbound = dg;
              // Wait for actual WebSocket open
              if (dg.dgWs) {
                dg.dgWs.on("open", () => {
                  outboundReady = true;
                  log("[DG] outbound WebSocket opened", "deepgram");
                  checkBothReady();
                });
              }
            };
            setupInboundEarly();
            setupOutboundEarly();
            break;

          case "start":
            if (message.start) {
              streamSid = message.start.streamSid;
              callSid = message.start.callSid;

              // Resolve which user owns this call so its transcripts/hints go
              // only to that user. The call is accepted (setCallOwner) before
              // Twilio opens the media stream, so the map is normally populated;
              // fall back to the pendingCalls table just in case.
              streamUserId = callOwners.get(callSid);
              if (!streamUserId) {
                const sidForLookup = callSid;
                db.select({ userId: pendingCalls.userId })
                  .from(pendingCalls)
                  .where(eq(pendingCalls.callSid, sidForLookup))
                  .limit(1)
                  .then((rows) => {
                    const uid = rows[0]?.userId;
                    if (uid) {
                      streamUserId = uid;
                      callOwners.set(sidForLookup, uid);
                      log(`[TwilioStream] Resolved owner ${uid} for ${sidForLookup} via DB`, "twilio");
                    } else {
                      log(`[TwilioStream] No owner found for ${sidForLookup}`, "twilio");
                    }
                  })
                  .catch((err) => log(`[TwilioStream] Owner lookup failed: ${err}`, "twilio"));
              }
              
              // Check for PSTN forwarding mode (roles inverted)
              const callType = message.start.customParameters?.callType;
              isPstnForwarding = callType === "pstn_forwarding";
              // Incoming answered calls (browser <Dial><Client> and the iOS
              // <Dial><Conference> bridge) attach the stream to the CALLER's leg,
              // so inbound/outbound are mirrored vs a browser outbound call.
              streamOnCallerLeg = callType === "incoming_answered";
              
              log(`Stream started: ${callSid}, callType: ${callType || 'browser'}, isPstnForwarding: ${isPstnForwarding}, streamOnCallerLeg: ${streamOnCallerLeg}`, "twilio");
              log(`Tracks: ${message.start.tracks?.join(", ")}`, "twilio");
              
              // Log track roles for debugging
              if (streamOnCallerLeg) {
                log(`[Track Mapping] caller-leg stream: GST=inbound, HON=outbound`, "twilio");
              } else {
                log(`[Track Mapping] owner-leg stream: HON=inbound, GST=outbound`, "twilio");
              }
              
              // Initialize Goal State Engine for this call
              goalEngine = getOrCreateEngine(callSid);
              log(`[GoalEngine] Initialized for call: ${callSid}`, "goal");
              
              // Note: Deepgram already initialized on "connected" event for early capture
              log(`[Deepgram] Deepgram ready: ${deepgramReady}, inbound: ${!!deepgramInbound}, outbound: ${!!deepgramOutbound}`, "deepgram");
            }
            break;

          case "media":
            audioFrameCount++;
            if (message.media?.payload) {
              const track = message.media.track;
              const audioData = Buffer.from(message.media.payload, "base64");
              
              // Track audio frames per track for debugging
              if (audioFrameCount === 1) {
                log(`[Audio] First frame received on track: ${track}`, "twilio");
              }
              
              // Buffer audio if Deepgram not ready yet (should be rare)
              if (!deepgramReady) {
                if (audioBuffer.length < 500) { // Limit buffer size
                  audioBuffer.push({ track, data: audioData });
                }
                if (audioBuffer.length === 1) {
                  log(`[AUDIO] buffering start - DG not ready`, "twilio");
                }
              } else {
                // Send audio to appropriate Deepgram connection
                if (track === "inbound" && deepgramInbound) {
                  deepgramInbound.send(audioData);
                } else if (track === "outbound" && deepgramOutbound) {
                  deepgramOutbound.send(audioData);
                }
              }
              
              // Log periodically with track info
              if (audioFrameCount === 50) {
                log(`[Audio] 50 frames received, stream is active`, "twilio");
              }
              if (audioFrameCount % 500 === 0) {
                log(`Audio frames: ${audioFrameCount}`, "twilio");
              }
            }
            break;

          case "stop":
            log(`Stream ended: ${callSid}, total frames: ${audioFrameCount}`, "twilio");
            // Close Deepgram connections
            if (deepgramInbound) {
              deepgramInbound.finish();
              deepgramInbound = null;
            }
            if (deepgramOutbound) {
              deepgramOutbound.finish();
              deepgramOutbound = null;
            }
            // Cleanup GoalEngine
            if (callSid) {
              removeEngine(callSid);
            }
            break;
        }
      } catch (err: any) {
        log(`Twilio error: ${err.message}`, "twilio");
      }
    });

    // Log pong responses from Twilio
    ws.on("pong", () => {
      log(`[Twilio] pong received`, "twilio");
    });
    
    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString() || "no reason";
      const duration = ((Date.now() - new Date(startTime).getTime()) / 1000).toFixed(1);
      log(`[Twilio] WS closed code=${code} reason="${reasonStr}" duration=${duration}s callSid=${callSid}`, "twilio");
      
      // Clear keepalive interval
      clearInterval(twilioKeepaliveInterval);
      
      // Cleanup Deepgram connections
      if (deepgramInbound) {
        deepgramInbound.finish();
        deepgramInbound = null;
      }
      if (deepgramOutbound) {
        deepgramOutbound.finish();
        deepgramOutbound = null;
      }
      // Cleanup GoalEngine
      if (callSid) {
        removeEngine(callSid);
        utteranceGate.cleanup(callSid);
        clearCallOwner(callSid);
      }
      
      // Reset hint throttling, anti-loop guards, and wait state for next call
      lastHintTs = 0;
      lastHintUtteranceId = -1;
      goalAchievedFlag = false;
      lastSuggestionIntent = "";
      lastSuggestionText = "";
      waitingForInfo = false;
      waitAckShown = false;
      waitingSlot = null;
      log(`[Cleanup] Hint throttling, anti-loop guards, wait state reset`, "websocket");
    });
    
    ws.on("error", (err) => {
      log(`[Twilio] WS error: ${err.message}`, "twilio");
    });
  }
  
  return wss;
}
