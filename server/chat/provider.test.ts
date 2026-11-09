import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  responses = { create: mocks.create };
  constructor(options: unknown) { mocks.options(options); }
} }));
import { ResponsesChatProvider, CHAT_MODEL } from "./provider";
const planFixture = { goal: "Ask price", ownerFacts: [], sayAsk: ["Ask price"],
  expectedQuestions: [], unknowns: [], disclosurePolicy: { allowed: [], forbidden: ["Do not pay"] },
  language: "en", executor: "hint" };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
beforeEach(() => { vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", ""); vi.stubEnv("GOOGLE_MAPS_API_KEY", ""); });
describe("Chat 1A real transport contract (network mocked)", () => {
  it("uses verified Responses model, disables retries/storage and permits only a proposal tool", async () => {
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
    expect(body.tools.map(t => t.name)).toEqual(["propose_call_plan"]);
    expect(body.parallel_tool_calls).toBe(false);
    expect(options.signal).toBe(controller.signal);
    expect(events).toEqual([{ requestId: "req_http" }, { text: "Hello" }, { complete: true, usage: { output_tokens: 1 } }]);
  });
  it("does not invoke provider without configured key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const run = async () => { for await (const _ of new ResponsesChatProvider().generate([], [], new AbortController().signal)) {} };
    await expect(run()).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("streams a validated proposal only after successful model completion, never executes it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-credential");
    mocks.create.mockReturnValue({ withResponse: async () => ({ data: (async function* () {
      yield { type: "response.output_item.done", item: { type: "function_call", name: "propose_call_plan",
        arguments: JSON.stringify(planFixture) } };
      yield { type: "response.completed", response: {} };
    })() }) });
    const events = [];
    for await (const event of new ResponsesChatProvider().generate([], [], new AbortController().signal)) events.push(event);
    expect(events[0]).toEqual({ text: planFixture.goal });
    expect(events[1].action?.plan).toEqual(planFixture);
    expect(events[1].action?.status).toBe("proposed");
    expect(events.at(-1)?.complete).toBe(true);
  });
  it.each(["start_call", "prepare_secretary_plan"])("rejects an unsolicited privileged tool %s", async name => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-credential");
    mocks.create.mockReturnValue({ withResponse: async () => ({ data: (async function* () {
      yield { type: "response.output_item.done", item: { type: "function_call", name, arguments: "{}" } };
    })() }) });
    const run = async () => { for await (const _ of new ResponsesChatProvider().generate([], [], new AbortController().signal)) {} };
    await expect(run()).rejects.toThrow("INVALID_PLAN_PROPOSAL");
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("continues a read-only place-search tool round, keeps sourced results and never dials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-credential");
    const search = vi.fn(async () => ({ source: "Google Maps", places: [{ name: "Fixture", phone: "+14055550123", price: null }] }));
    mocks.create.mockReturnValueOnce({ withResponse: async () => ({ request_id: "search-round",
      data: (async function* () {
        const item = { type: "function_call", name: "search_places", call_id: "search1",
          arguments: JSON.stringify({ query: "Fontaine parts", city: "Springfield", route: "I-44 E", highwayOnly: true }) };
        yield { type: "response.output_item.done", item };
        yield { type: "response.completed", response: { output: [item], usage: { input_tokens: 10, output_tokens: 5 } } };
      })() }) });
    mocks.create.mockReturnValueOnce({ withResponse: async () => ({ request_id: "reply-round",
      data: (async function* () {
        yield { type: "response.output_text.delta", delta: "Fixture — price needs a call." };
        yield { type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 8 } } };
      })() }) });
    const events = [];
    for await (const event of new ResponsesChatProvider({ available: () => true, search }).generate(
      [{ role: "user", text: "Find parts", status: "complete" } as any], [], new AbortController().signal)) events.push(event);
    expect(search).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0].input).toContainEqual(expect.objectContaining({ type: "function_call_output",
      output: expect.stringContaining('"price":null') }));
    expect(events.filter(e => e.usage)).toHaveLength(2);
    expect(events.at(-1)?.complete).toBe(true);
    expect(mocks.create.mock.calls.flatMap(c => c[0].tools.map(t => t.name))).not.toContain("start_call");
  });
  it("removes the search tool after a failed external lookup; no blind retry", async () => {
    vi.stubEnv("OPENAI_API_KEY", "unit-test-not-a-credential");
    const search = vi.fn(async () => { throw Error("provider body not for the model"); });
    mocks.create.mockReturnValueOnce({ withResponse: async () => ({
      data: (async function* () {
        const item = { type: "function_call", name: "search_places", call_id: "search1", arguments: '{"query":"parts","city":"Tulsa"}' };
        yield { type: "response.output_item.done", item };
        yield { type: "response.completed", response: { output: [item] } };
      })() }) });
    mocks.create.mockReturnValueOnce({ withResponse: async () => ({
      data: (async function* () {
        yield { type: "response.output_text.delta", delta: "Search unavailable." };
        yield { type: "response.completed", response: {} };
      })() }) });
    for await (const _ of new ResponsesChatProvider({ available: () => true, search }).generate([], [], new AbortController().signal)) {}
    expect(mocks.create.mock.calls[1][0].tools.map(t => t.name)).toEqual(["propose_call_plan"]);
    expect(search).toHaveBeenCalledOnce();
  });
});
