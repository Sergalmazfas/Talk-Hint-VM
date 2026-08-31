import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import {
  buildIOSTranslatorConfig,
  handleIOSTranslatorStream,
  IOS_TRANSLATOR_SAMPLE_RATE,
  isValidPCM16Frame,
} from "../translation/iosTranslator";
import type {
  RealtimeTranslationProvider,
  RealtimeTranslationSession,
} from "../translation/provider";

describe("native iOS translator contract", () => {
  it("is fixed to bidirectional RU/EN PCM16 at 24 kHz", () => {
    expect(buildIOSTranslatorConfig()).toEqual({
      languages: ["ru", "en"],
      sourceLangHint: "auto",
      inputFormat: { encoding: "pcm16", sampleRateHz: 24_000 },
      outputFormat: { encoding: "pcm16", sampleRateHz: 24_000 },
    });
    expect(IOS_TRANSLATOR_SAMPLE_RATE).toBe(24_000);
  });

  it("does not opt into directed output mode", () => {
    expect(buildIOSTranslatorConfig().outputLanguage).toBeUndefined();
  });

  it("accepts only non-empty, bounded, sample-aligned PCM16 frames", () => {
    expect(isValidPCM16Frame(960)).toBe(true);
    expect(isValidPCM16Frame(0)).toBe(false);
    expect(isValidPCM16Frame(959)).toBe(false);
    expect(isValidPCM16Frame(96 * 1024 + 2)).toBe(false);
  });

  it("cancels a provider session that resolves after stop", async () => {
    class FakeSocket extends EventEmitter {
      readonly OPEN = 1;
      readyState = 1;
      sent: string[] = [];
      send(value: string) {
        this.sent.push(value);
      }
    }

    let resolveStart!: (session: RealtimeTranslationSession) => void;
    const pendingStart = new Promise<RealtimeTranslationSession>((resolve) => {
      resolveStart = resolve;
    });
    const provider: RealtimeTranslationProvider = {
      name: "delayed-test-provider",
      startSession: vi.fn(() => pendingStart),
    };
    const cancel = vi.fn();
    const delayedSession: RealtimeTranslationSession = {
      sendAudio: vi.fn(),
      stop: vi.fn(async () => {}),
      cancel,
      onEvent: vi.fn(),
    };
    const socket = new FakeSocket();
    handleIOSTranslatorStream(socket as unknown as WebSocket, "test-user", provider);

    socket.emit("message", Buffer.from('{"type":"start"}'), false);
    await Promise.resolve();
    socket.emit("message", Buffer.from('{"type":"stop"}'), false);
    resolveStart(delayedSession);
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancel).toHaveBeenCalledOnce();
    expect(socket.sent.some((frame) => JSON.parse(frame).type === "session_config")).toBe(false);
  });
});