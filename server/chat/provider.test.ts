import { describe, it, expect, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  responses = { create: mocks.create };
  constructor(options: unknown) { mocks.options(options); }
} }));
import { ResponsesChatProvider, CHAT_MODEL } from "./provider";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Chat 1A real transport contract (network mocked)", () => {
  it("uses verified Responses model, disables retries/storage/tools and streams deltas", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-credential");
    const input: any = [{ role: "user", text: "Hello", status: "complete" }];
    mocks.create.mockReturnValue({ withResponse: async () => ({
      request_id: "req_http",
      data: (async function* () {
        yield { type: "response.output_text.delta", delta: "Hello" };
        yield { type: "response.completed", response: { usage: { output_tokens: 1 } } };
      })(),
    }) });
    const events = [];
    const controller = new AbortController();
    for await (const event of new ResponsesChatProvider().generate(input, [], controller.signal)) events.push(event);
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    const [body, options] = mocks.create.mock.calls[0];
    expect(body).toMatchObject({ model: CHAT_MODEL, stream: true, store: false });
    expect(body).not.toHaveProperty("tools");
    expect(options.signal).toBe(controller.signal);
    expect(events).toEqual([{ requestId: "req_http" }, { text: "Hello" }, { complete: true, usage: { output_tokens: 1 } }]);
  });
  it("does not invoke provider without configured key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const run = async () => { for await (const _ of new ResponsesChatProvider().generate([], [], new AbortController().signal)) {} };
    await expect(run()).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
