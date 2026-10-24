import { describe, expect, it } from "vitest";
import { savedRetellAdmission, retellEnded, retellError } from "./secretary-lab-retell";

describe("Retell browser control boundary", () => {
  it("serves one admission from memory without external requests or a permanent credential", async () => {
    const read = savedRetellAdmission({ call_id: "one", access_token: "short-lived", transport: "gateway" });
    const result = await read("https://api.retellai.com/v3/create-web-call", { method: "POST" });
    expect(await result.json()).toMatchObject({ call_id: "one" });
    await expect(read("https://api.retellai.com/v3/create-web-call", { method: "POST" })).rejects.toThrow();
  });
  it.each([
    ["https://evil.example/v3/create-web-call", "POST"],
    ["https://api.retellai.com/v3/create-web-call?token=bad", "POST"],
    ["https://api.retellai.com/v3/create-web-call", "GET"],
    ["https://api.retellai.com/v2/create-phone-call", "POST"],
    ["https://api.retellai.com/v2/stop-call/other", "POST"],
  ])("does not become a generic SDK proxy: %s %s", async (url, method) => {
    await expect(savedRetellAdmission({})(url, { method })).rejects.toThrow("заблокирован");
  });
  it("does not treat a failed stop as ended or confuse microphone denial with an API key problem", () => {
    expect(retellEnded("stop_failed")).toBe(false);
    expect(retellEnded("ended")).toBe(true);
    expect(retellError(new Error("NotAllowedError: Permission denied"))).toContain("микрофону");
    expect(retellError(new Error("HTTP 403"))).toContain("ключ");
    expect(retellError(new Error("Retell HTTP 402"))).toContain("баланс");
  });
});
