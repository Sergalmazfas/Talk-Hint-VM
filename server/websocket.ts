import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { spawn } from "child_process";
import { log } from "./index";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const uiClients = new Set<WebSocket>();

function uiBroadcast(message: object) {
  const data = JSON.stringify(message);
  uiClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function convertMulawToPCM16(base64Payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const inputBuffer = Buffer.from(base64Payload, "base64");

    const ffmpeg = spawn("ffmpeg", [
      "-f", "mulaw", "-ar", "8000", "-ac", "1", "-i", "pipe:0",
      "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("base64"));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

function convertPCM16ToMulaw(base64PCM: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const inputBuffer = Buffer.from(base64PCM, "base64");

    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "pipe:0",
      "-f", "mulaw", "-ar", "8000", "-ac", "1", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("base64"));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    ffmpeg.on("error", reject);
    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}

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
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
        },
      },
    });
  }

  private send(message: object) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendAudio(base64PCM: string) {
    this.send({ type: "input_audio_buffer.append", audio: base64PCM });
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case "session.created":
        this.sessionId = message.session?.id;
        log(`Session created: ${this.sessionId}`, "openai");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (message.transcript) {
          log(`User: ${message.transcript}`, "transcript");
          this.onTranscript({ role: "user", text: message.transcript });
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

  function handleUIConnection(ws: WebSocket) {
    log("UI client connected", "server");
    uiClients.add(ws);

    ws.send(JSON.stringify({ type: "connected", timestamp: Date.now(), mode: currentMode }));

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "set_mode") {
          currentMode = message.mode;
          log(`Mode changed to: ${currentMode}`, "server");
          ws.send(JSON.stringify({ type: "mode_changed", mode: currentMode }));
          uiBroadcast({ type: "mode_changed", mode: currentMode });
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
                ws.send(JSON.stringify({ type: "response", sessionId, ...response }));
                uiBroadcast({ type: "hon_response", sessionId, ...response });
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
            if (gptHandler) gptHandler.disconnect();
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
    let gptHandler: GPTRealtimeHandler | null = null;
    let streamSid: string | null = null;
    let callSid: string | null = null;

    ws.on("message", async (data: Buffer) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());

        switch (message.event) {
          case "start":
            if (message.start) {
              streamSid = message.start.streamSid;
              callSid = message.start.callSid;
              log(`Call started: ${callSid}`, "twilio");

              gptHandler = new GPTRealtimeHandler({
                mode: currentMode,
                onTranscript: (transcript) => {
                  uiBroadcast({ type: "gst_transcript", callSid, ...transcript });
                },
                onResponse: (response) => {
                  uiBroadcast({ type: "ai_hint", callSid, text: response.text });
                  uiBroadcast({ type: "response", callSid, ...response });
                },
                onAudio: () => {
                  // Phone Mode: AI audio goes to UI only, not back to caller
                },
                onError: (error) => {
                  uiBroadcast({ type: "error", callSid, error: error.message || error });
                },
              });

              await gptHandler.connect();
              uiBroadcast({ type: "call_started", callSid, streamSid });
            }
            break;

          case "media":
            if (gptHandler && message.media?.payload) {
              try {
                const pcm16Audio = await convertMulawToPCM16(message.media.payload);
                gptHandler.sendAudio(pcm16Audio);
              } catch (err: any) {
                log(`Conversion error: ${err.message}`, "twilio");
              }
            }
            break;

          case "stop":
            log(`Call ended: ${callSid}`, "twilio");
            if (gptHandler) gptHandler.disconnect();
            uiBroadcast({ type: "call_ended", callSid });
            break;
        }
      } catch (err: any) {
        log(`Twilio error: ${err.message}`, "twilio");
      }
    });

    ws.on("close", () => {
      if (gptHandler) gptHandler.disconnect();
      if (callSid) uiBroadcast({ type: "call_ended", callSid });
    });
  }

  return wss;
}
