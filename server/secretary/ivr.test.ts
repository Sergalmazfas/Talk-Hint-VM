import { describe, expect, it, vi } from "vitest";
import { SecretaryIvr, menuChoices } from "./ivr";

const menu = "For truck tires and repair, press two. For a manager, press eight. For wireless, press nine.";
const signal = () => new AbortController().signal;
const user = (content: string) => ({ role: "user" as const, content });
const agent = (content: string) => ({ role: "agent" as const, content });
function fixture() {
  const io = { send: vi.fn(async () => {}), record: vi.fn(async () => {}),
    notify: vi.fn(async () => {}), remember: vi.fn(async () => {}) };
  return { io, ivr: new SecretaryIvr(io) };
}
async function press(ivr: SecretaryIvr, digits = "2", heard = menu) {
  return ivr.tool("press_digits", JSON.stringify({ digits, heard_menu: heard, menu_complete: true }), signal());
}
describe("Secretary IVR safety and navigation (no network)", () => {
  it("recognizes spoken English digits, multi-digit code and # terminator", () => {
    expect(menuChoices(menu)).toEqual(["2", "8", "9"]);
    expect(menuChoices("Press 1# for repair. Press 0 for operator.")).toEqual(["1#", "0"]);
    expect(menuChoices("нажмите 2")).toEqual(["2"]);
    expect(menuChoices("I need two tires and nine minutes.")).toEqual([]);
  });
  it("dispatches a listed choice, audits before dispatch, and never claims destination acceptance", async () => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]);
    expect(await press(ivr)).toMatchObject({ ok: true, sent: true, destinationAccepted: "unknown", silent: true });
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.record.mock.invocationCallOrder[0]).toBeLessThan(io.send.mock.invocationCallOrder[0]);
    expect(io.record.mock.calls.at(-1)?.[0]).toMatchObject({ digits: "2", heard: menu, result: "command_sent_destination_acceptance_unknown" });
    expect(ivr.blocksEnd()).toBe(true);
  });
  it.each(["123456", "", "2w2", "+2", "2,2", "１２", "2\n"])("rejects non-menu/private syntax %j", async digits => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]);
    await expect(press(ivr, digits)).rejects.toThrow(); expect(io.send).not.toHaveBeenCalled();
  });
  it.each(["PIN", "credit card number", "account number", "phone number", "zip code", "date of birth", "payment", "verification code"])(
    "denies sensitive entry even if the requested digit was explicitly heard: %s", async subject => {
      const { io, ivr } = fixture(); const text = `For ${subject}, enter 2.`;
      await ivr.observe([user(text)]); await expect(press(ivr, "2", text)).rejects.toThrow();
      expect(io.send).not.toHaveBeenCalled();
    });
  it("requires a complete current quoted menu, not model-invented evidence", async () => {
    const { ivr } = fixture(); await ivr.observe([user(menu)]);
    await expect(press(ivr, "2", "Press 2")).rejects.toThrow();
    await expect(ivr.tool("press_digits", JSON.stringify({ digits: "2", heard_menu: menu, menu_complete: false }), signal())).rejects.toThrow();
    await expect(press(ivr, "0")).rejects.toThrow();
  });
  it("refuses aborted, duplicate and concurrent commands", async () => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]);
    const abort = new AbortController(); abort.abort();
    await expect(ivr.tool("press_digits", JSON.stringify({ digits: "2", heard_menu: menu, menu_complete: true }), abort.signal)).rejects.toThrow();
    const outcomes = await Promise.allSettled([press(ivr), press(ivr)]);
    expect(outcomes.filter(v => v.status === "fulfilled")).toHaveLength(1);
    expect(io.send).toHaveBeenCalledTimes(1);
  });
  it("does not automatically replay a dispatch whose outcome is unknown", async () => {
    const { io, ivr } = fixture(); io.send.mockRejectedValueOnce(Error("socket closed"));
    await ivr.observe([user(menu)]); await expect(press(ivr)).rejects.toThrow();
    expect(ivr.status().pressesWithoutNewMenu).toBe(1);
    expect(io.record.mock.calls.at(-1)?.[0]).toMatchObject({ result: "dispatch_pending" });
  });
  it("on repeated menu allows representative then 0, rather than the same wrong selection", async () => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]); await press(ivr);
    await ivr.observe([user(menu), agent("Please connect me."), user(menu)]);
    await expect(press(ivr)).rejects.toThrow(/Repeated menu/);
    await expect(press(ivr, "0")).rejects.toThrow();
    await ivr.observe([user(menu), agent("representative"), user(menu)]);
    await expect(press(ivr, "0")).resolves.toMatchObject({ digits: "0" });
    expect(io.send).toHaveBeenCalledTimes(2);
  });
  it("enforces five digits without a new menu", async () => {
    const { ivr } = fixture(); const text = "Press 12345 for repair.";
    await ivr.observe([user(text)]); await press(ivr, "12345", text);
    await ivr.observe([user(text), agent("representative"), user(text)]);
    await expect(press(ivr, "0", text)).rejects.toThrow(/limit/);
  });
  it("pushes once, waits without ending, and accepts one owner response for this exact menu", async () => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]);
    await ivr.tool("request_menu_help", "{}", signal());
    await ivr.tool("request_menu_help", "{}", signal());
    expect(io.notify).toHaveBeenCalledTimes(1);
    expect(ivr.blocksEnd()).toBe(true);
    await expect(press(ivr)).rejects.toThrow(/Waiting/);
    await expect(ivr.press("2", "stale", signal(), true)).rejects.toThrow();
    const hash = ivr.status().menuHash;
    await expect(ivr.press("2", hash, signal(), true)).resolves.toMatchObject({ sent: true });
    await expect(ivr.press("2", hash, signal(), true)).rejects.toThrow();
  });
  it("does not hide missing push delivery, does not hang up and never blindly retries mail/APNs", async () => {
    const { io, ivr } = fixture(); io.notify.mockRejectedValueOnce(Error("No alert certificate"));
    await ivr.observe([user(menu)]);
    await ivr.tool("request_menu_help", "{}", signal());
    await ivr.tool("request_menu_help", "{}", signal());
    expect(io.notify).toHaveBeenCalledTimes(1);
    expect(ivr.status()).toMatchObject({ waiting: true, helpDelivery: "unavailable" });
    expect(ivr.blocksEnd()).toBe(true);
  });
  it("saves a route only after an evidenced live answer, then offers it for the exact menu", async () => {
    const { io, ivr } = fixture(); await ivr.observe([user(menu)]); await press(ivr);
    await expect(ivr.tool("confirm_menu_reached", JSON.stringify({ heard: "Hello, tire department speaking." }), signal())).rejects.toThrow();
    const heard = "Hello, tire department speaking.";
    await ivr.observe([user(menu), agent(""), user(heard)]);
    await ivr.tool("confirm_menu_reached", JSON.stringify({ heard }), signal());
    expect(io.remember).toHaveBeenCalledWith([{ menuHash: ivr.status().menuHash, digits: "2" }]);
    expect(ivr.blocksEnd()).toBe(false);
    const next = new SecretaryIvr(io, io.remember.mock.calls[0][0]);
    await next.observe([user(menu)]); expect(next.context()).toContain('"rememberedChoiceForThisExactMenu":"2"');
    await next.observe([user("For restaurant, press two.")]);
    expect(next.context()).toContain('"rememberedChoiceForThisExactMenu":null');
  });
});
