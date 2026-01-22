import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { TALKHINT_GOLDEN_PROMPT, PREP_PROMPT, LANGUAGE_NAMES, MODE_PROMPTS, getModePrompt, getFullPrompt, LIVE_ANTI_LOOP_RULES } from "@shared/prompts";
import { FastLayerManager, FastPhraseResult, FAST_THRESHOLD_MS, FAST_COOLDOWN_MS } from "./fastLayer";
import { getOrCreateEngine, removeEngine, GoalEngine } from "./goalEngine";
import { UtteranceGate } from "./utteranceGate";
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
        model: "gpt-4o-mini",
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

Return JSON: {"translation":"guest's words in ${langName}", "suggestion":{"en":"reply in ENGLISH", "translation":"same reply in ${langName}"}}`
          },
          {
            role: "user",
            content: `Guest said: "${text}"`
          }
        ],
        temperature: 0.4,
        max_tokens: 120
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
      return {
        translation: parsed.translation || "",
        explanation: parsed.explanation || undefined,
        suggestion: parsed.suggestion || undefined,
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

function uiBroadcast(message: object) {
  const data = JSON.stringify(message);
  const openClients = Array.from(uiClients).filter(c => c.readyState === WebSocket.OPEN).length;
  log(`[uiBroadcast] Sending to ${openClients} clients: ${(message as any).type}`, "server");
  uiClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
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
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;

    if (["/twilio-stream", "/media", "/honor-stream", "/ui"].includes(pathname)) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, pathname);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, request: any, pathname: string) => {
    if (pathname === "/ui") {
      handleUIConnection(ws);
    } else if (pathname === "/honor-stream") {
      handleHonorStream(ws);
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
  
  function handleUIConnection(ws: WebSocket) {
    log("UI client connected", "server");
    uiClients.add(ws);

    ws.send(JSON.stringify({ type: "connected", timestamp: Date.now(), goal: currentGoal }));

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
    });
  }

  function handleHonorStream(ws: WebSocket) {
    log("Browser mic connected", "honor");
    let gptHandler: GPTRealtimeHandler | null = null;
    let sessionId: string | null = null;

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
    let audioFrameCount = 0;
    let isPstnForwarding = false; // PSTN forwarding mode - roles are inverted
    let goalEngine: GoalEngine | null = null; // Goal State Engine per call
    let deepgramReady = false; // Flag to track if Deepgram is ready
    const audioBuffer: { track: string; data: Buffer }[] = []; // Buffer for early audio
    
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
    const utteranceGate = new UtteranceGate(async (speaker, text, utteranceId) => {
      if (speaker === "GST") {
        await handleGuestUtteranceComplete(text, utteranceId);
      } else {
        handleOwnerUtteranceComplete(text, utteranceId);
      }
    });
    
    // Handler for complete GST utterance (after debounce)
    async function handleGuestUtteranceComplete(text: string, utteranceId: number) {
      log(`[UtteranceComplete] GST utterance #${utteranceId}: "${text.substring(0, 50)}..."`, "websocket");
      
      // Add to conversation log
      conversationLog.push({
        speaker: "Guest",
        text: text,
        timestamp: Date.now()
      });
      if (conversationLog.length > 10) conversationLog.shift();
      
      // Update GoalEngine
      if (goalEngine) {
        const goalUpdate = goalEngine.updateOnUtterance({
          speaker: "GST",
          text: text,
          ts: Date.now()
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
      
      // Trigger fast layer timer - GPT request starts now
      fastLayer.setLanguage(currentLanguage);
      fastLayer.onGstUtteranceEnd();
      
      const contextHistory = conversationLog.map(m => `${m.speaker}: ${m.text}`).join("\n");
      const translated = await translateAndSuggest(text, currentGoal, currentLanguage, contextHistory);
      
      // GPT response received - stop fast layer timer
      fastLayer.onGptResponseReceived();
      
      // Broadcast translation
      uiBroadcast({ 
        type: "guest_transcript",
        text: text,
        translation: translated.translation,
        isFinal: true,
        isComplete: true,
        utteranceId,
        callSid
      });
      
      if (translated.suggestion) {
        log(`[Suggestion] Sending to HON, basedOn=GST, utteranceId=${utteranceId}`, "websocket");
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
      }
    }
    
    // Handler for complete HON utterance (after debounce)
    function handleOwnerUtteranceComplete(text: string, utteranceId: number) {
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
      
      // Use raw WebSocket for more control
      const dgUrl = "wss://api.deepgram.com/v1/listen?model=nova-2&language=en-US&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&punctuate=true&vad_events=true";
      
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
        
        // Start keepalive ping every 10 seconds
        keepaliveInterval = setInterval(() => {
          if (dgWs.readyState === WebSocket.OPEN) {
            dgWs.send(JSON.stringify({ type: "KeepAlive" }));
            log(`[DG] ${track}: keepalive ping`, "deepgram");
          }
        }, 10000);
      });
      
      dgWs.on("message", async (data: any) => {
        try {
          const response = JSON.parse(data.toString());
          
          // Handle VAD events (SpeechStarted, UtteranceEnd)
          if (response.type === "SpeechStarted") {
            log(`[DG] ${track}: SpeechStarted`, "deepgram");
            return;
          }
          if (response.type === "UtteranceEnd") {
            log(`[DG] ${track}: UtteranceEnd -> forcing flush`, "deepgram");
            const isGuestTrack = (track === "outbound");
            const speakerCode = isGuestTrack ? "GST" : "HON";
            utteranceGate.forceFlush(callSid || "unknown", speakerCode as "GST" | "HON");
            return;
          }
          
          const transcript = response.channel?.alternatives?.[0]?.transcript;
          if (transcript && transcript.trim()) {
            const isFinal = response.is_final;
            const speechFinal = response.speech_final === true;
            
            // Track mapping (CORRECTED):
            // Twilio Media Streams: inbound = audio INTO Twilio, outbound = audio OUT OF Twilio
            // Browser outbound call (isPstnForwarding=false): inbound=HON (browser mic), outbound=GST (remote PSTN)
            // PSTN forwarding (isPstnForwarding=true): inbound=HON (mobile owner), outbound=GST (original caller)
            // Both modes have SAME mapping: inbound=HON, outbound=GST
            const isGuestTrack = (track === "outbound");
            const isOwnerTrack = (track === "inbound");
            const speakerLabel = isOwnerTrack ? "Owner" : "Guest";
            const speakerCode = isGuestTrack ? "GST" : "HON";
            
            // Debug: log track mapping decision
            log(`[TrackDebug] track=${track}, isPstn=${isPstnForwarding}, isGuest=${isGuestTrack}, speaker=${speakerLabel} isFinal=${isFinal} speechFinal=${speechFinal}`, "deepgram");
            
            // Use utteranceGate to wait for complete utterance before GPT
            utteranceGate.processTranscript(callSid || "unknown", speakerCode as "GST" | "HON", transcript, isFinal, speechFinal, false);
            
            // Broadcast partial/final transcripts immediately for UI display
            if (isGuestTrack) {
              uiBroadcast({ type: "guest_transcript", text: transcript, isFinal, callSid });
            } else {
              uiBroadcast({ type: "owner_transcript", text: transcript, isFinal, callSid });
            }
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
              
              // Check for PSTN forwarding mode (roles inverted)
              const callType = message.start.customParameters?.callType;
              isPstnForwarding = callType === "pstn_forwarding";
              
              log(`Stream started: ${callSid}, callType: ${callType || 'browser'}, isPstnForwarding: ${isPstnForwarding}`, "twilio");
              log(`Tracks: ${message.start.tracks?.join(", ")}`, "twilio");
              
              // Log track roles for debugging
              // BOTH modes: inbound=HON (owner), outbound=GST (guest)
              log(`[Track Mapping] HON=inbound, GST=outbound (same for all modes)`, "twilio");
              
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
      }
    });
    
    ws.on("error", (err) => {
      log(`[Twilio] WS error: ${err.message}`, "twilio");
    });
  }
  
  // Filler phrases to use during GPT thinking time
  const FILLER_PHRASES = [
    { en: "Hmm, let me think...", ru: "Хмм, дайте подумать..." },
    { en: "Oh, that's interesting...", ru: "О, это интересно..." },
    { en: "I see, and so...", ru: "Понятно, и так..." },
    { en: "Right, right...", ru: "Да, да..." },
    { en: "Uh-huh, go on...", ru: "Угу, продолжайте..." },
    { en: "Well, you know...", ru: "Ну, знаете..." },
  ];
  
  let lastFillerTime = 0;
  let fillerIndex = 0;
  
  function getNextFiller(): { en: string; ru: string } {
    const filler = FILLER_PHRASES[fillerIndex % FILLER_PHRASES.length];
    fillerIndex++;
    return filler;
  }
  
  // Send a filler phrase to keep conversation flowing
  function sendFiller() {
    const now = Date.now();
    if (now - lastFillerTime < 5000) return; // Don't send fillers too often
    
    lastFillerTime = now;
    const filler = getNextFiller();
    uiBroadcast({ 
      type: "filler", 
      text: filler.en, 
      translation: filler.ru 
    });
    log(`Filler: ${filler.en}`, "openai");
  }
  
  // Generate AI hints based on conversation
  async function generateHints(history: { role: string; text: string }[]) {
    if (history.length < 1) return;
    
    const recentContext = history.slice(-5).map(h => `${h.role}: ${h.text}`).join("\n");
    const langName = LANGUAGE_NAMES[currentLanguage] || "Russian";
    
    // Start a timer for filler phrase
    const fillerTimer = setTimeout(() => sendFiller(), 2000);
    
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
              content: `${TALKHINT_GOLDEN_PROMPT}

USER'S CALL GOAL: ${currentGoal || "Have a successful conversation"}

This is a LIVE call. Help the user move toward the call goal. Correctness over speed — if unsure, stay silent.

Based on the conversation, give 1-2 SHORT phrases the user should SAY next.
Each phrase must move toward the GOAL above.
Each phrase must be under 15 words.
Include ${langName} translation.

Return JSON only:
{"hints": [{"en": "English phrase to say", "translation": "${langName} translation"}]}`
            },
            {
              role: "user",
              content: `Goal: ${currentGoal || "Have a successful conversation"}\n\nRecent conversation:\n${recentContext}\n\nWhat should user say next to achieve their goal?`
            }
          ],
          temperature: 0.5,
          max_tokens: 200,
        }),
      });
      
      clearTimeout(fillerTimer);
      
      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        
        try {
          const parsed = JSON.parse(content);
          if (parsed.hints) {
            uiBroadcast({ type: "hints", hints: parsed.hints });
            log(`Generated ${parsed.hints.length} hints`, "openai");
          }
        } catch {
          log("Failed to parse hints JSON", "openai");
        }
      }
    } catch (err: any) {
      clearTimeout(fillerTimer);
      log(`Hint generation error: ${err.message}`, "openai");
    }
  }

  return wss;
}
