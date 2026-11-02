import { describe, it, expect, vi } from "vitest";
import { englishFirstHint, readStrictHintStream, ENGLISH_SCHEMA } from "../liveHintEnglishFirst";
const reply = (data: unknown, finish = "stop") => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(data) }, finish_reason: finish }] })}\n\n` +
  "data: [DONE]\n\n", { headers: { "x-request-id": "req-test" } });
const args = { system: "GROUNDING RULES AND FULL CONTEXT", user: "Guest said: next?", guest: "Next?", language: "ru", model: "gpt-5.6-terra", translateEnabled: true };
const en = { type: "direct", en: "What is the next step?", options: [] };
const tr = { guestTranslation: "Дальше?", hintTranslation: "Какой следующий шаг?", optionTranslations: [], nativeHelper: "" };
describe("English first: strict, old-iPhone-compatible, no unsafe partials", () => {
  it("uses strict schema + SSE, resolves English before the translation; exactly one native request", async () => {
    const bodies: any[] = [];
    let resolve!: (v: Response) => void;
    const fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return reply(en);
      return new Promise<Response>(r => { resolve = r; });
    });
    const diagnostic = vi.fn();
    const r = await englishFirstHint(args, { fetch: fetch as any, diagnostic });
    expect(r.suggestion?.en).toBe(en.en); expect(r.suggestion?.translation).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
    const a = r.finishTranslation(), b = r.finishTranslation(); expect(a).toBe(b);
    expect(bodies[0].response_format).toEqual({ type: "json_schema", json_schema: { name: "hint_english_v1", strict: true, schema: ENGLISH_SCHEMA } });
    expect(bodies[0].stream).toBe(true);
    expect(bodies[0].messages[0].content).toContain(args.system);
    resolve(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(tr) } }] })));
    expect((await a).suggestion?.translation).toBe(tr.hintTranslation);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(args.guest);
  });
  it("Translation OFF: no second request or native helper", async () => {
    const fetch = vi.fn(async () => reply(en));
    const r = await englishFirstHint({ ...args, translateEnabled: false }, { fetch: fetch as any, diagnostic: vi.fn() });
    expect(await r.finishTranslation()).toEqual({ translation: "", suggestion: r.suggestion });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("permission revoked during English generation prevents the native request", async () => {
    const fetch = vi.fn(async () => reply(en));
    const translationAllowed = vi.fn(async () => false);
    const r = await englishFirstHint({ ...args, translationAllowed }, { fetch: fetch as any, diagnostic: vi.fn() });
    expect((await r.finishTranslation()).translation).toBe("");
    expect(translationAllowed).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["length", "content_filter"])("rejects unfinished %s without retry", async finish => {
    const fetch = vi.fn(async () => reply(en, finish));
    await expect(englishFirstHint(args, { fetch: fetch as any, diagnostic: vi.fn() })).rejects.toThrow("TRUNCATED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects schema drift / invalid CHOICE", async () => {
    for (const data of [{ ...en, surprise: true }, { ...en, type: "choice", options: [{ label: "yes", en: "Yes" }] }]) {
      await expect(englishFirstHint(args, { fetch: (async () => reply(data)) as any, diagnostic: vi.fn() })).rejects.toThrow();
    }
  });
  it("CHOICE retains canonical compat English after native translations", async () => {
    let n = 0;
    const r = await englishFirstHint(args, { diagnostic: vi.fn(), fetch: (async () => ++n === 1 ?
      reply({ type: "choice", en: "", options: [{ label: "yes", en: "Yes." }, { label: "no", en: "Not yet." }] }) :
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...tr, optionTranslations: ["Да.", "Ещё нет."] }) } }] }))) as any });
    expect((await r.finishTranslation()).suggestion?.en).toBe(r.suggestion?.en);
    expect(r.suggestion?.en).toContain("If yes:");
  });
  it("rejects refusal and stream cutoff, accepts split UTF-8 SSE", async () => {
    await expect(readStrictHintStream(new Response('data: {"choices":[{"delta":{"refusal":"No"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))).rejects.toThrow();
    await expect(readStrictHintStream(new Response('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'))).rejects.toThrow();
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ en: "Hello — yes" }) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    const response = new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }));
    expect(await readStrictHintStream(response)).toEqual({ en: "Hello — yes" });
  });
  it("does not log provider bodies on HTTP errors or retry them", async () => {
    const fetch = vi.fn(async () => new Response("secret-or-personal-body", { status: 400 }));
    const diagnostic = vi.fn();
    await expect(englishFirstHint(args, { fetch: fetch as any, diagnostic })).rejects.toThrow("HTTP_400");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("secret-or-personal-body");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
