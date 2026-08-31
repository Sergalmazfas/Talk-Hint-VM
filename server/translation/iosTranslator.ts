import type WebSocket from "ws";
import { tlog as log } from "./logger";
import { openaiRealtimeTranslationProvider } from "./openaiRealtimeTranslator";
import type {
  RealtimeTranslationProvider,
  RealtimeTranslationSession,
  TranslationEvent,
} from "./provider";
import type { RealtimeTranslationConfig } from "./provider";

/**
 * The native Translator screen deliberately has a smaller contract than the
 * developer spike: it is always the verified current gpt-realtime adapter and
 * always translates the RU↔EN pair in both directions.
 *
 * This is a separate channel from /ui and /twilio-stream. In particular, no
 * audio sent here is ever sent to Deepgram or to the Hint pipeline.
 */
export const IOS_TRANSLATOR_SAMPLE_RATE = 24_000;
const MAX_AUDIO_FRAME_BYTES = 96 * 1024;

export function isValidPCM16Frame(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= MAX_AUDIO_FRAME_BYTES && byteLength % 2 === 0;
}

type TranslatorStartMessage = {
  type: "start";
  languages?: unknown;
  sourceLangHint?: unknown;
};

function send(ws: WebSocket, value: object) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
}

function isTranslatorStart(value: any): value is TranslatorStartMessage {
  return value && value.type === "start";
}

/** Fixed production config; client messages cannot select a model or direction. */
export function buildIOSTranslatorConfig(): RealtimeTranslationConfig {
  return {
    languages: ["ru", "en"],
    sourceLangHint: "auto",
    inputFormat: { encoding: "pcm16", sampleRateHz: IOS_TRANSLATOR_SAMPLE_RATE },
    outputFormat: { encoding: "pcm16", sampleRateHz: IOS_TRANSLATOR_SAMPLE_RATE },
  };
}

function forwardEvent(ws: WebSocket, event: TranslationEvent) {
  if (event.type === "translated_audio") {
    send(ws, {
      type: "audio",
      data: event.base64,
      responseId: event.responseId,
    });
    return;
  }
  send(ws, event);
}

/**
 * Handles the authenticated native iOS translator socket.
 *
 * The socket carries binary PCM16 mono 24 kHz frames in the client→server
 * direction and JSON event frames (including base64 audio) back to iOS. The
 * provider adapter remains the only code that knows the OpenAI wire format.
 */
export function handleIOSTranslatorStream(
  ws: WebSocket,
  userId: string,
  provider: RealtimeTranslationProvider = openaiRealtimeTranslationProvider,
) {
  let session: RealtimeTranslationSession | null = null;
  let generation = 0;
  let startingGeneration: number | null = null;
  let closed = false;

  const fail = (message: string, fatal = true) => {
    send(ws, { type: "error", message, fatal });
  };

  ws.on("message", async (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!isValidPCM16Frame(data.length)) {
        fail("Invalid PCM16 translator audio frame");
        return;
      }
      if (!session) {
        fail("Translator session is not ready", false);
        return;
      }
      session.sendAudio(data);
      return;
    }

    let message: any;
    try {
      message = JSON.parse(data.toString());
    } catch {
      fail("Invalid translator message");
      return;
    }

    if (isTranslatorStart(message)) {
      if (session || startingGeneration !== null) return;
      const thisGeneration = ++generation;
      startingGeneration = thisGeneration;
      try {
        // Ignore client-controlled provider/language/model values. This
        // endpoint is intentionally the fixed, approved RU↔EN mode.
        const started = await provider.startSession(
          buildIOSTranslatorConfig(),
        );

        if (closed || ws.readyState !== ws.OPEN || generation !== thisGeneration) {
          started.cancel();
          return;
        }

        session = started;
        send(ws, {
          type: "session_config",
          direction: "bidirectional",
          languages: ["ru", "en"],
          provider: "openai-realtime",
          model: process.env.TRANSLATOR_SPIKE_MODEL || "gpt-realtime",
          inputFormat: { encoding: "pcm16", sampleRateHz: IOS_TRANSLATOR_SAMPLE_RATE },
          outputFormat: { encoding: "pcm16", sampleRateHz: IOS_TRANSLATOR_SAMPLE_RATE },
        });
        started.onEvent((event) => {
          forwardEvent(ws, event);
          if (event.type === "closed" && !closed) {
            fail("Translator provider session closed");
          }
        });
        log(`[IOSTranslator] session started for user ${userId}`, "translator");
      } catch (error: any) {
        if (generation === thisGeneration && !closed) {
          fail(error?.message || "Unable to start translator");
          log(`[IOSTranslator] start failed for user ${userId}: ${error?.message}`, "translator");
        }
      } finally {
        if (startingGeneration === thisGeneration) {
          startingGeneration = null;
        }
      }
      return;
    }

    if (message?.type === "stop") {
      generation += 1;
      await session?.stop();
      session = null;
      return;
    }

    fail("Unknown translator message", false);
  });

  ws.on("close", () => {
    closed = true;
    generation += 1;
    session?.cancel();
    session = null;
    log(`[IOSTranslator] socket closed for user ${userId}`, "translator");
  });
}