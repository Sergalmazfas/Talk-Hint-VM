import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

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

const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian",
  es: "Spanish"
};

// Translate guest speech and generate suggestion
async function translateAndSuggest(text: string, goal: string, language: string = "ru"): Promise<{
  translation: string;
  explanation?: string;
  suggestion?: { en: string; translation: string };
}> {
  const langName = LANGUAGE_NAMES[language] || "Russian";
  
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
            content: `You help a ${langName} speaker during an English phone call.

TASK: Given what the other person (Guest) just said, provide:
1. ${langName} translation of their speech
2. A suggested SHORT response (under 15 words) the user should say, aligned with their goal

GOAL: ${goal || "Have a successful phone conversation"}

CRITICAL: Suggestions must be SHORT ready-to-say phrases. NO explanations, NO teaching, NO options.

Return JSON only:
{
  "translation": "${langName} translation of what Guest said",
  "suggestion": { "en": "Short English response to say", "translation": "${langName} translation of response" }
}`
          },
          {
            role: "user",
            content: `Guest said: "${text}"`
          }
        ],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`GPT API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // Parse JSON response
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

const BASE_RULES = `
CRITICAL RULES:
1. You are helping HON (the Host/Owner) during a live conversation
2. GST (Guest) is the other person on the call - you hear them but NEVER speak for them
3. You provide SHORT hints to HON only
4. Never pretend to be GST or generate GST's responses
5. Keep all suggestions under 15 words
6. Use simple, clear language
7. Respond in the same language as the conversation
8. If you hear silence, stay silent
9. Only provide hints when truly helpful
`;

const PROMPTS: Record<string, string> = {
  universal: `You are TalkHint - a real-time voice assistant helping HON (Host) during phone calls.

ROLES:
- HON (Host/Owner): The person you're helping. They wear an earpiece and hear your hints.
- GST (Guest): The caller on the other end. You hear them but NEVER speak as them.

${BASE_RULES}

YOUR CAPABILITIES:
- Listen to both HON and GST in real-time
- Provide quick hints, translations, or suggestions to HON
- Help with difficult questions or forgotten information
- Suggest polite phrases or responses
- Translate if languages differ

RESPONSE STYLE:
- Whisper-like: short, direct hints
- Format: "Say: [suggestion]" or "Hint: [info]"
- Never full sentences unless translating
- No greetings or pleasantries in hints

EXAMPLES:
- "Say: Let me check that for you"
- "Hint: They want a refund"
- "Price is $50/hour"
- "Say: I understand, one moment"
`,

  massage: `You are TalkHint - a real-time assistant for massage salon staff.

ROLES:
- HON (Host): Massage therapist or receptionist you're helping
- GST (Guest): Client calling to book or inquire

${BASE_RULES}

DOMAIN KNOWLEDGE:
- Common massage types: Swedish, Deep Tissue, Hot Stone, Thai, Sports
- Session lengths: 30, 60, 90, 120 minutes
- Booking flow: date, time, type, therapist preference
- Upsells: aromatherapy, hot stones, extended time

RESPONSE STYLE:
- Quick booking hints
- Price suggestions
- Availability phrases
- Upsell opportunities
- Polite rebooking scripts

EXAMPLES:
- "Say: We have 2pm available"
- "Offer: Add hot stones for $20"
- "Say: Swedish is great for relaxation"
- "Ask: Preferred therapist?"
- "60min deep tissue: $90"
`,

  dispatcher: `You are TalkHint - a real-time assistant for dispatchers and call center agents.

ROLES:
- HON (Host): Dispatcher handling incoming calls
- GST (Guest): Customer or field worker calling in

${BASE_RULES}

DOMAIN KNOWLEDGE:
- Call routing and transfers
- Ticket/order status lookups
- Escalation procedures
- Common customer issues
- ETA calculations

RESPONSE STYLE:
- Status updates
- Routing suggestions
- De-escalation phrases
- Quick reference info
- Next steps

EXAMPLES:
- "Say: Let me transfer you to billing"
- "ETA: 15 minutes"
- "Say: I apologize for the delay"
- "Escalate to supervisor"
- "Order status: shipped yesterday"
`,
};

function getRealtimePrompt(mode: string = "universal"): string {
  return (PROMPTS[mode] || PROMPTS.universal).trim();
}

let currentMode = "universal";
let currentLanguage = "ru"; // Default to Russian, can be "ru" or "es"
const uiClients = new Set<WebSocket>();

function uiBroadcast(message: object) {
  const data = JSON.stringify(message);
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
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: getRealtimePrompt(this.mode),
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
        } else if (message.type === "update_goal") {
          currentGoal = message.goal || "";
          log(`Goal updated: ${currentGoal.substring(0, 50)}...`, "server");
        } else if (message.type === "set_language") {
          const lang = message.language;
          if (lang === "ru" || lang === "es") {
            currentLanguage = lang;
            log(`Language changed to: ${currentLanguage}`, "server");
            ws.send(JSON.stringify({ type: "language_changed", language: currentLanguage }));
          }
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
    log("Twilio stream connected", "twilio");
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let audioFrameCount = 0;
    
    // Deepgram connections for each track
    let deepgramInbound: any = null;
    let deepgramOutbound: any = null;
    
    // Create Deepgram client
    const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY || "");
    
    // Setup Deepgram live transcription for a track
    function setupDeepgram(track: string) {
      log(`[Deepgram] Setting up for track: ${track}`, "deepgram");
      
      const connection = deepgramClient.listen.live({
        model: "nova-2",
        language: "en",
        smart_format: true,
        encoding: "mulaw",
        sample_rate: 8000,
        channels: 1,
        interim_results: true,
        utterance_end_ms: 1000,
        vad_events: true,
      });
      
      connection.on(LiveTranscriptionEvents.Open, () => {
        log(`[Deepgram] ${track} connection opened`, "deepgram");
      });
      
      connection.on(LiveTranscriptionEvents.Transcript, async (data: any) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          const isFinal = data.is_final;
          // inbound = Owner (browser/WebRTC), outbound = Guest (phone)
          const speaker = track === "inbound" ? "Owner" : "Guest";
          
          if (isFinal) {
            log(`[Deepgram] ${speaker} final: ${transcript}`, "deepgram");
            
            if (track === "outbound") {
              // Guest transcript - translate and generate suggestion
              const translated = await translateAndSuggest(transcript, currentGoal, currentLanguage);
              uiBroadcast({ 
                type: "guest_transcript",
                text: transcript,
                translation: translated.translation,
                isFinal: true,
                callSid 
              });
              
              if (translated.suggestion) {
                uiBroadcast({
                  type: "suggestion",
                  en: translated.suggestion.en,
                  translation: translated.suggestion.translation,
                  callSid
                });
              }
            } else {
              // Owner transcript
              uiBroadcast({ 
                type: "owner_transcript",
                text: transcript,
                isFinal: true,
                callSid 
              });
            }
          } else {
            log(`[Deepgram] ${speaker} partial: ${transcript}`, "deepgram");
          }
        }
      });
      
      connection.on(LiveTranscriptionEvents.Error, (err: any) => {
        log(`[Deepgram] ${track} error: ${err.message || err}`, "deepgram");
      });
      
      connection.on(LiveTranscriptionEvents.Close, () => {
        log(`[Deepgram] ${track} connection closed`, "deepgram");
      });
      
      return connection;
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
            break;

          case "start":
            if (message.start) {
              streamSid = message.start.streamSid;
              callSid = message.start.callSid;
              log(`Stream started: ${callSid}`, "twilio");
              log(`Tracks: ${message.start.tracks?.join(", ")}`, "twilio");
              
              // Initialize Deepgram for both tracks
              deepgramInbound = setupDeepgram("inbound");
              deepgramOutbound = setupDeepgram("outbound");
            }
            break;

          case "media":
            audioFrameCount++;
            if (message.media?.payload) {
              const track = message.media.track;
              const audioData = Buffer.from(message.media.payload, "base64");
              
              // Send audio to appropriate Deepgram connection
              if (track === "inbound" && deepgramInbound) {
                deepgramInbound.send(audioData);
              } else if (track === "outbound" && deepgramOutbound) {
                deepgramOutbound.send(audioData);
              }
              
              // Log periodically
              if (audioFrameCount === 1 || audioFrameCount % 500 === 0) {
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
            break;
        }
      } catch (err: any) {
        log(`Twilio error: ${err.message}`, "twilio");
      }
    });

    ws.on("close", () => {
      log(`Twilio WS closed, callSid: ${callSid}`, "twilio");
      // Cleanup Deepgram connections
      if (deepgramInbound) {
        deepgramInbound.finish();
        deepgramInbound = null;
      }
      if (deepgramOutbound) {
        deepgramOutbound.finish();
        deepgramOutbound = null;
      }
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
              content: `You are a real-time assistant helping someone during a phone call. Based on the conversation, suggest 3 SHORT response options they could say next. Each suggestion should be:
1. Natural and conversational
2. Under 15 words
3. Helpful for continuing the conversation

Return ONLY a JSON object with this format:
{"hints": [{"en": "English phrase", "ru": "Russian translation"}, {"en": "...", "ru": "..."}, {"en": "...", "ru": "..."}]}`
            },
            {
              role: "user",
              content: `Recent conversation:\n${recentContext}\n\nSuggest 3 response options:`
            }
          ],
          temperature: 0.7,
          max_tokens: 300,
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
