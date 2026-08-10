// Contract tests for the VERIFIED Tutor Engine production API (/api/v1).
// fetch is mocked — these prove OUR client sends exactly the verified shapes:
// correct paths, Bearer key, user_id, no application_id/organization_id, and
// correct pending/ready/failed Call Memory handling.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: { url: string; init: any }[] = [];
let responder: (url: string) => { status: number; body: any };

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responder(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
}

describe("Tutor Engine client contract (verified production API)", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.TUTOR_ENGINE_API_KEY = "test-key-0000000000000000000000";
    process.env.TUTOR_ENGINE_APP_ID = "some-app-uuid";
    vi.resetModules();
    mockFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses /api/v1 paths with the backend Bearer key", async () => {
    responder = () => ({ status: 200, body: { realtime_audio: true } });
    const eng = await import("../tutorEngine");
    await eng.getCapabilities();
    expect(calls[0].url).toBe("https://ai-tutor-engine.replit.app/api/v1/capabilities");
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer test-key/);
  });

  it("creates sessions with user_id and WITHOUT application_id/organization_id", async () => {
    responder = () => ({ status: 201, body: { session_id: "s1", realtime: { connection_url: "/api/v1/realtime", token: "t" } } });
    const eng = await import("../tutorEngine");
    await eng.createTutorSession("user-abc");
    expect(calls[0].url).toBe("https://ai-tutor-engine.replit.app/api/v1/sessions");
    const payload = JSON.parse(calls[0].init.body);
    expect(payload).toMatchObject({
      user_id: "user-abc",
      tutor_id: "emma_us_01",
      scenario_id: "english_free_talk",
      mode: "practice",
      target_language: "en",
      native_language: "ru",
    });
    expect(payload).not.toHaveProperty("application_id");
    expect(payload).not.toHaveProperty("organization_id");
  });

  it("completes sessions via POST /api/v1/sessions/:id/complete", async () => {
    responder = () => ({ status: 200, body: { status: "ended" } });
    const eng = await import("../tutorEngine");
    await eng.completeTutorSession("sess-1");
    expect(calls[0].url).toBe("https://ai-tutor-engine.replit.app/api/v1/sessions/sess-1/complete");
    expect(calls[0].init.method).toBe("POST");
  });

  it("starts generation via POST and reports NO_COMPLETED_TURNS distinctly", async () => {
    responder = () => ({ status: 409, body: { error: { code: "NO_COMPLETED_TURNS" } } });
    const eng = await import("../tutorEngine");
    const r = await eng.startCallMemoryGeneration("sess-1");
    expect(r.noTurns).toBe(true);
    expect(calls[0].init.method).toBe("POST");
  });

  it("fetchCallMemory handles pending / failed / ready and normalizes {text} items", async () => {
    const eng = await import("../tutorEngine");
    responder = () => ({ status: 200, body: { status: "pending" } });
    expect((await eng.fetchCallMemory("s")).status).toBe("pending");

    responder = () => ({ status: 200, body: { status: "failed", retriable: true } });
    const failed = await eng.fetchCallMemory("s");
    expect(failed).toMatchObject({ status: "failed", retriable: true });

    responder = () => ({ status: 200, body: {
      status: "ready",
      latest: { content: {
        objective: "Fix the heater",
        facts: [{ text: "Apartment 14", status: "unconfirmed" }],
        dates_times: [{ text: "since Monday" }],
        questions: [{ text: "Can you send a repairman?" }],
        vocabulary: [{ text: "landlord" }],
        rehearsed_answers: [{ text: "The heater has been broken since Monday." }],
        uncertain_facts: [],
      } },
    } });
    const ready = await eng.fetchCallMemory("s");
    expect(ready.status).toBe("ready");
    const mem = (ready as any).memory;
    expect(mem.objective).toBe("Fix the heater");
    expect(mem.facts).toEqual(["Apartment 14", "since Monday"]); // dates_times folded into facts
    expect(mem.questions).toEqual(["Can you send a repairman?"]);
    // GET is read-only: only GET requests were issued by fetchCallMemory
    expect(calls.every((c) => !c.init.method || c.init.method === "GET")).toBe(true);
  });

  it("treats CALL_MEMORY_NOT_GENERATED 404 as not_started (GET never triggers)", async () => {
    responder = () => ({ status: 404, body: { error: { code: "CALL_MEMORY_NOT_GENERATED" } } });
    const eng = await import("../tutorEngine");
    expect((await eng.fetchCallMemory("s")).status).toBe("not_started");
  });
});
