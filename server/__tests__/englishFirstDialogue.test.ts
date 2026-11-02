import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { deliverGuestCaption } from "../liveGuestCaption";
import { englishFirstHint } from "../liveHintEnglishFirst";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const englishResponse = () => new Response(
  'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"direct\\",\\"en\\":\\"Is installation included?\\",\\"options\\":[]}"},"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n",
);
const args = { system: "Grounded hint", user: "Price?", guest: "The total is $100.",
  language: "ru", model: "gpt-5.6-terra", translateEnabled: true };
function delivery(emit = vi.fn(), allowed = async () => true, closed = () => false) {
  return { emit, closed, translationAllowed: allowed, failed: vi.fn() };
}
describe("English-first dialogue: independent guest translation and hint", () => {
  it("delivers CALLER translation even while English generation is unresolved", async () => {
    const english = deferred<Response>();
    const hint = englishFirstHint(args, { fetch: vi.fn(() => english.promise) as any, diagnostic: vi.fn() });
    const deps = delivery();
    await deliverGuestCaption(Promise.resolve({ translation: "Итого сто долларов.", providerUsed: "caption" }), deps);
    expect(deps.emit).toHaveBeenCalledWith({ translation: "Итого сто долларов.", providerUsed: "caption" });
    english.resolve(englishResponse());
    expect((await hint).suggestion?.en).toBe("Is installation included?");
  });
  it("delivers English before a slow caption and later delivers its independent translation", async () => {
    const caption = deferred<{ translation: string; providerUsed: string }>();
    const deps = delivery();
    const sent = deliverGuestCaption(caption.promise, deps);
    const hint = await englishFirstHint(args, { fetch: vi.fn(async () => englishResponse()) as any, diagnostic: vi.fn() });
    expect(hint.suggestion?.en).toBe("Is installation included?");
    expect(deps.emit).not.toHaveBeenCalled();
    caption.resolve({ translation: "Итого сто долларов.", providerUsed: "caption" });
    await sent;
    expect(deps.emit).toHaveBeenCalledTimes(1);
  });
  it("hint failure cannot suppress the guest's translated dialogue", async () => {
    const deps = delivery();
    await Promise.all([
      expect(englishFirstHint(args, { fetch: vi.fn(async () => new Response("", { status: 503 })) as any,
        diagnostic: vi.fn() })).rejects.toThrow("HTTP_503"),
      deliverGuestCaption(Promise.resolve({ translation: "Цена?", providerUsed: "caption" }), deps),
    ]);
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ translation: "Цена?" }));
  });
  it("caption failure does not reject or prevent the English hint", async () => {
    const deps = delivery();
    await deliverGuestCaption(Promise.reject(Error("unavailable")), deps);
    expect(deps.failed).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith({ translation: "", providerUsed: "translation_error" });
    const hint = await englishFirstHint(args, { fetch: vi.fn(async () => englishResponse()) as any, diagnostic: vi.fn() });
    expect(hint.suggestion?.en).toBeTruthy();
  });
  it("revoked translation permission clears native text; a closed call emits nothing", async () => {
    const result = { translation: "Не показывать", providerUsed: "caption" };
    const off = delivery(vi.fn(), async () => false);
    await deliverGuestCaption(Promise.resolve(result), off);
    expect(off.emit).toHaveBeenCalledWith({ ...result, translation: "" });
    const closed = delivery(vi.fn(), async () => true, () => true);
    await deliverGuestCaption(Promise.resolve(result), closed);
    expect(closed.emit).not.toHaveBeenCalled();
  });
  it("fails closed if permissions cannot be read or the stream closes during that read", async () => {
    const result = { translation: "Нет", providerUsed: "caption" };
    const failed = delivery(vi.fn(), async () => { throw Error("database"); });
    await deliverGuestCaption(Promise.resolve(result), failed);
    expect(failed.emit).toHaveBeenCalledWith({ ...result, translation: "" });
    let closed = false;
    const deps = delivery(vi.fn(), async () => { closed = true; return true; }, () => closed);
    await deliverGuestCaption(Promise.resolve(result), deps);
    expect(deps.emit).not.toHaveBeenCalled();
  });
  it("real websocket starts guest translation in both modes, never via finishTranslation", () => {
    const source = readFileSync("server/websocket.ts", "utf8");
    const start = source.slice(source.indexOf("const translationStart ="), source.indexOf("// ===== LIBRARY-FIRST LOOKUP"));
    expect(start).toContain("translationEnabled\n          ? translateGuestText(");
    expect(start).not.toContain("!useEnglishFirst");
    expect(source).toContain("deliverGuestCaption(translationPromise,");
    expect(source).not.toContain("translationPromise = firstEnglish");
  });
});
