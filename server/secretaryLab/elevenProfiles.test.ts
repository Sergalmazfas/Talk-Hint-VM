import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamSecretaryResponse } from "../secretary/conversationEngine";
import { ElevenLabApi, ELEVEN_CATALOG } from "./elevenApi";
import { elevenProfiles } from "../../shared/elevenLabProfiles";
import { WebSocketServer } from "ws";
const transport = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = transport; } }));
beforeEach(() => {
  vi.stubEnv("REPLIT_DEV_DOMAIN", "unit.replit.dev");
  transport.create.mockReset();
  transport.create.mockImplementation(async () => (async function* () {
    yield { type: "response.output_text.delta", delta: "Hello" };
    yield { type: "response.completed", response: { output: [] } };
  })());
});
afterEach(() => vi.unstubAllEnvs());
describe("isolated ElevenLabs experiments", () => {
  it("accepts a bounded multi-second provider PCM frame larger than the former 256KiB limit", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => server.on("listening", resolve));
    server.on("connection", socket => socket.send(JSON.stringify({ type: "audio",
      audio_event: { audio_base_64: "A".repeat(400_000), event_id: 1 } })));
    const socket = new ElevenLabApi().socket(`ws://127.0.0.1:${(server.address() as any).port}`);
    try {
      const frame = await new Promise<Buffer>((resolve, reject) => { socket.once("message", b => resolve(b as Buffer)); socket.once("error", reject); });
      expect(JSON.parse(frame.toString()).audio_event.audio_base_64).toHaveLength(400_000);
    } finally {
      socket.terminate(); for (const s of server.clients) s.terminate();
      await new Promise<void>(r => server.close(() => r()));
    }
  });
  it("keeps the shared default medium before and after an explicit low request", async () => {
    const input = { instructions: "TEST", input: [], signal: new AbortController().signal };
    for await (const _ of streamSecretaryResponse(input)) {}
    for await (const _ of streamSecretaryResponse(input, { reasoning: "low" })) {}
    for await (const _ of streamSecretaryResponse(input)) {}
    expect(transport.create.mock.calls.map(c => c[0].reasoning.effort)).toEqual(["medium", "low", "medium"]);
    expect(transport.create.mock.calls[0][0]).toEqual(transport.create.mock.calls[2][0]);
    for (const [body] of transport.create.mock.calls) {
      expect(body.model).toBe("gpt-6.1-sol");
      expect(body.parallel_tool_calls).toBe(false);
      expect(body.stream).toBe(true);
      expect(body.tools.map((t: any) => t.name)).toEqual(["read_test_context", "save_test_message", "prepare_test_booking"]);
    }
  });
  it("changes only the chosen ElevenLabs synthesis / turn parameter", () => {
    const api = new ElevenLabApi();
    const base = api.configuration("TEST", ELEVEN_CATALOG.voiceId, "fixture");
    const flash = api.configuration("TEST", ELEVEN_CATALOG.voiceId, "fixture", "flash");
    const eager = api.configuration("TEST", ELEVEN_CATALOG.voiceId, "fixture", "eager");
    expect(base.conversation_config.tts.model_id).toBe("eleven_multilingual_v2");
    expect(flash.conversation_config.tts.model_id).toBe("eleven_flash_v2_5");
    expect(flash.conversation_config.turn).toEqual(base.conversation_config.turn);
    expect(eager.conversation_config.tts).toEqual(base.conversation_config.tts);
    expect(eager.conversation_config.turn.turn_eagerness).toBe("eager");
    expect(eager.conversation_config.turn.speculative_turn).toBe(false);
    expect(flash.conversation_config.agent.prompt).toEqual(base.conversation_config.agent.prompt);
    expect(elevenProfiles.optimized.turnEagerness).toBe("normal");
  });
});
