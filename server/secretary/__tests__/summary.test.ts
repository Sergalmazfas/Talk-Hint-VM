import { describe, it, expect, vi } from "vitest";
import { summarizeSecretaryReport, secretarySummaryFormat } from "../summary";
import { validateSecretaryReport } from "../tasks";

const task = { id: "report-fixture", instruction: "Ask an installation estimate", translationLanguage: "ru",
  transcript: "Secretary: Сколько стоит работа с материалами?\nGuest: Примерно сто пятьдесят долларов.\nSecretary: Завтра к полудню можно?\nGuest: Да, сможем." };
const report = { outcome: "resolved", summary: "Получены ориентир цены и согласие приехать.",
  verifiedFacts: [{ fact: "Цена приблизительная.", quote: "Примерно сто пятьдесят долларов." }],
  nextStep: "Подтвердить работы и окончательную цену на месте." };
function setup(data: any, status = 200, requestId = "req_fixture") {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), {
    status, headers: { "x-request-id": requestId },
  })) as unknown as typeof fetch;
  const log = vi.fn();
  return { fetcher, log, apiKey: "fake-test-credential" };
}
const completed = (raw: unknown = report) => ({
  status: "completed", output: [{ type: "message", content: [{ type: "output_text",
    text: typeof raw === "string" ? raw : JSON.stringify(raw) }] }],
  usage: { output_tokens: 140, output_tokens_details: { reasoning_tokens: 0 } },
});
describe("Secretary report extraction (no live Katya change)", () => {
  it("extracts a grounded successful conversation and logs metadata, never evidence or keys", async () => {
    const o = setup(completed());
    const result = await summarizeSecretaryReport(task, validateSecretaryReport, o);
    expect(result.outcome).toBe("resolved");
    expect(result.verifiedFacts).toEqual(["Цена приблизительная."]);
    const body = JSON.parse((vi.mocked(o.fetcher).mock.calls[0][1] as any).body);
    expect(body.text.format).toEqual(secretarySummaryFormat);
    expect(body).toMatchObject({ model: "gpt-5.6-sol", reasoning: { effort: "none" }, max_output_tokens: 2000 });
    expect(o.log).toHaveBeenCalledWith(expect.objectContaining({
      reason: "validated", httpStatus: 200, requestId: "req_fixture", reasoningTokens: 0,
    }));
    const logged = JSON.stringify(o.log.mock.calls);
    for (const secret of [o.apiKey, task.transcript, report.summary, report.verifiedFacts[0].quote])
      expect(logged).not.toContain(secret);
  });
  it("reproduces reasoning-only/incomplete output: unknown, a recorded reason, no repair or retry", async () => {
    const o = setup({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "reasoning" }], usage: { output_tokens: 650, output_tokens_details: { reasoning_tokens: 650 } } });
    expect((await summarizeSecretaryReport(task, validateSecretaryReport, o)).outcome).toBe("unknown");
    expect(o.log).toHaveBeenCalledWith(expect.objectContaining({ reason: "incomplete_response", reasoningTokens: 650 }));
    expect(o.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [completed("{bad json"), "invalid_json"],
    [{ status: "completed", output: [] }, "empty_output"],
    [{ status: "failed" }, "invalid_response_status"],
    [completed({ ...report, verifiedFacts: [{ fact: "Invented", quote: "Not in transcript" }] }), "no_verified_quotes"],
  ])("distinguishes invalid/empty/ungrounded responses without false success", async (data, reason) => {
    const o = setup(data);
    expect((await summarizeSecretaryReport(task, validateSecretaryReport, o)).outcome).toBe("unknown");
    expect(o.log).toHaveBeenCalledWith(expect.objectContaining({ reason }));
    expect(o.fetcher).toHaveBeenCalledTimes(1);
  });
  it("never prints HTTP bodies or a malicious request-id", async () => {
    const o = setup({ error: { message: "secret user transcript fake-test-credential" } }, 400, "bad id with private data");
    expect((await summarizeSecretaryReport(task, validateSecretaryReport, o)).outcome).toBe("unknown");
    expect(o.log).toHaveBeenCalledWith(expect.objectContaining({ reason: "http_error", httpStatus: 400, requestId: null }));
    expect(JSON.stringify(o.log.mock.calls)).not.toContain("private");
    expect(JSON.stringify(o.log.mock.calls)).not.toContain("fake-test");
  });
  it("records bounded timeout without a second request", async () => {
    const o = setup(null);
    o.fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("private transport error")));
    })) as typeof fetch;
    await summarizeSecretaryReport(task, validateSecretaryReport, { ...o, timeoutMs: 5 });
    expect(o.log).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }));
    expect(o.fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not invent a success or call a provider for empty input or missing key", async () => {
    const o = setup(null);
    await summarizeSecretaryReport(task, validateSecretaryReport, { ...o, apiKey: "" });
    await summarizeSecretaryReport({ ...task, transcript: "" }, validateSecretaryReport, o);
    expect(o.fetcher).not.toHaveBeenCalled();
  });
  it("does not force a reasoning parameter on an explicitly configured different model", async () => {
    const o = setup(completed());
    await summarizeSecretaryReport(task, validateSecretaryReport, { ...o, model: "configured-report-model" });
    const body = JSON.parse((vi.mocked(o.fetcher).mock.calls[0][1] as any).body);
    expect(body.reasoning).toBeUndefined();
  });
});
