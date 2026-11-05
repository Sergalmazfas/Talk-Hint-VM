import { describe, expect, it } from "vitest";
import { DevWaitingPolicy, addressedReturn } from "./waitingPolicy";
import { WAITING_LAB_PLANS, waitingPlanInstruction, waitingPlanSelection } from "../../shared/secretaryWaitingPlans";
describe("owner-approved waiting acknowledgements and returns", () => {
  it.each(["one sec", "give me a minute", "секунду", "посмотрю", "на складе"])("acknowledges %s only once", text => {
    const p = new DevWaitingPolicy();
    p.observe(text, true, false); expect(p.takeAcknowledgement()).toBeUndefined();
    p.observe(text, false, true);
    expect(p.takeAcknowledgement()?.acknowledgement).toBe(true);
    p.observe(text.toUpperCase() + ".", false, true);
    expect(p.takeAcknowledgement()).toBeUndefined();
    expect(p.events.filter(x => x.type === "acknowledged")).toHaveLength(1);
    expect(p.waiting).toBe(true);
  });
  it.each(["Кать, ты меня слышишь?", "Здесь?", "Ты здесь?", "Вы здесь", "Слышите?", "Катюш!", "Катюша",
    "Katya?", "Kate!", "you there", "hello", "are you there?"])("answers explicit address %s", text => {
    const p = new DevWaitingPolicy(); p.observe("let me check", false, true);
    p.observe(text, false, true); expect(p.waiting).toBe(false);
    expect(addressedReturn(text)).toBe(true);
  });
  it("short ambiguous turn requires 1.2 seconds of measured, uninterrupted silence", () => {
    let now = 0; const p = new DevWaitingPolicy(() => now);
    p.observe("на складе", false, true); p.takeAcknowledgement();
    now = 5000; p.observe("Ну что?", false, true); p.audio(false);
    now = 6199; expect(p.tick()).toBeUndefined(); expect(p.waiting).toBe(true);
    now = 6200; expect(p.tick()?.resume).toBe(true); expect(p.waiting).toBe(false);
  });
  it("continuation and background speech cannot satisfy the pause criterion", () => {
    let now = 0; const p = new DevWaitingPolicy(() => now);
    p.observe("let me check", false, true); p.takeAcknowledgement();
    p.observe("Some words", true, false); p.audio(false);
    now = 1100; p.audio(true); now = 2000; expect(p.tick()).toBeUndefined();
    p.observe("John, can you check the shelf?", false, true); p.audio(false);
    now = 3500; expect(p.tick()).toBeUndefined(); expect(p.waiting).toBe(true);
  });
  it("a missing microphone signal is not proof of a pause", () => {
    let now = 0; const p = new DevWaitingPolicy(() => now);
    p.observe("let me check", false, true); p.takeAcknowledgement(); p.observe("Ну что?", false, true);
    now = 1300; expect(p.tick()).toBeUndefined(); expect(p.waiting).toBe(true);
  });
  it("replays the recorded 1:26 and 1:50 addresses with no provider/model calls", () => {
    let now = 77_720; const p = new DevWaitingPolicy(() => now);
    p.observe("Секунду подожди, пожалуйста, я сейчас вернусь. Посмотрю на складе есть или нет, хорошо?", false, true);
    expect(p.takeAcknowledgement()?.text).toBe("Конечно, жду.");
    now = 86_690; p.observe("Кать, ты меня слышишь?", false, true);
    expect(p.waiting).toBe(false);
    now = 98_630; p.observe("Да, подожди минуту, я сейчас на складе посмотрю, хорошо?", false, true);
    expect(p.takeAcknowledgement()?.text).toBe("Конечно, жду.");
    now = 110_860; p.observe("Здесь?", false, true);
    expect(p.waiting).toBe(false);
    expect(p.events.filter(e => e.type === "returned")).toHaveLength(2);
  });
  it("presets retain structured facts/limits and cannot be silently used on A/B or edited", () => {
    const tire = WAITING_LAB_PLANS[0]; const instruction = waitingPlanInstruction(tire.plan);
    expect(instruction.length).toBeLessThanOrEqual(1600);
    expect(instruction).toContain("295/75R22.5"); expect(instruction).toContain("$400");
    expect(instruction).toContain("right rear inner");
    expect(waitingPlanSelection("C", instruction, tire.id)?.plan).toEqual(tire.plan);
    expect(() => waitingPlanSelection("A", instruction, tire.id)).toThrow();
    expect(() => waitingPlanSelection("C", "edited", tire.id)).toThrow();
    expect(waitingPlanSelection("C", "custom")).toBeUndefined();
  });
});
