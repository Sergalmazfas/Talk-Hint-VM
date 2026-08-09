// TUTOR_ENGINE_APP_ID wiring: session creation must send the secret value as
// application_id (never a hardcoded word), and startup must warn when the
// secret is missing.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_APP_ID = process.env.TUTOR_ENGINE_APP_ID;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TUTOR_ENGINE_APP_ID", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TUTOR_ENGINE_API_KEY = process.env.TUTOR_ENGINE_API_KEY || "test-key";
  });

  afterEach(() => {
    if (ORIGINAL_APP_ID === undefined) delete process.env.TUTOR_ENGINE_APP_ID;
    else process.env.TUTOR_ENGINE_APP_ID = ORIGINAL_APP_ID;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("checkTutorEngineAppIdConfigured warns and returns false when the secret is missing", async () => {
    delete process.env.TUTOR_ENGINE_APP_ID;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkTutorEngineAppIdConfigured } = await import("../tutorEngine");
    expect(checkTutorEngineAppIdConfigured()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TUTOR_ENGINE_APP_ID"));
  });

  it("checkTutorEngineAppIdConfigured is silent and returns true when the secret is set", async () => {
    process.env.TUTOR_ENGINE_APP_ID = "my-app-id";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkTutorEngineAppIdConfigured } = await import("../tutorEngine");
    expect(checkTutorEngineAppIdConfigured()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("createTutorSession retries with the secret value as application_id, not 'talkhint'", async () => {
    process.env.TUTOR_ENGINE_APP_ID = "my-app-id";
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: any, init: any) => {
      bodies.push(init?.body ? JSON.parse(init.body) : null);
      if (bodies.length === 1) {
        return jsonResponse(400, { error: "application_id is required" });
      }
      return jsonResponse(200, { session_id: "s1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { createTutorSession } = await import("../tutorEngine");
    const result = await createTutorSession("user-1");

    expect(result).toEqual({ session_id: "s1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].application_id).toBeUndefined();
    expect(bodies[1].application_id).toBe("my-app-id");
    expect(JSON.stringify(bodies)).not.toContain('"talkhint"');
  });

  it("createTutorSession fails with not_configured when the engine demands application_id and the secret is unset", async () => {
    delete process.env.TUTOR_ENGINE_APP_ID;
    const fetchMock = vi.fn(async () => jsonResponse(400, { error: "application_id is required" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { createTutorSession, TutorEngineError } = await import("../tutorEngine");
    await expect(createTutorSession("user-1")).rejects.toMatchObject({
      kind: "not_configured",
    });
    await expect(createTutorSession("user-1")).rejects.toBeInstanceOf(TutorEngineError);
    // No retry with a fabricated identity.
    expect(fetchMock).toHaveBeenCalledTimes(2); // one per createTutorSession call
  });
});
