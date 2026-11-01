import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatcherErrorCode, startCrewDispatcher } from "./dispatcher";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("production dispatcher", () => {
  it("registers the actual 15-second interval in production, not Dev", async () => {
    vi.useFakeTimers();
    const tick=vi.fn(async()=>{}), observePublication=vi.fn(async()=>{}), report=vi.fn();
    expect(startCrewDispatcher({environment:"development",tick,observePublication,report})).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    startCrewDispatcher({environment:"production",tick,observePublication,report});
    expect(report).toHaveBeenCalledWith("dispatcher_started",{intervalMs:15000});
    await vi.advanceTimersByTimeAsync(14999);expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);expect(tick).toHaveBeenCalledTimes(2);
    expect(observePublication).toHaveBeenCalledTimes(1);
  });
  it("reports a failed publication gate without ticking, and releases busy after exceptions",async()=>{
    vi.useFakeTimers();
    const observePublication=vi.fn().mockRejectedValueOnce(Error("secret URL/token must not be logged")).mockResolvedValue(undefined);
    const tick=vi.fn().mockRejectedValueOnce(Error("EVIDENCE_CHANGED")).mockResolvedValue(undefined),report=vi.fn();
    startCrewDispatcher({environment:"production",tick,observePublication,report});
    await vi.advanceTimersByTimeAsync(15000);
    expect(tick).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("dispatcher_failed",{phase:"publication",code:"DISPATCH_FAILED"});
    await vi.advanceTimersByTimeAsync(15000);
    expect(report).toHaveBeenCalledWith("dispatcher_failed",{phase:"tick",code:"EVIDENCE_CHANGED"});
    await vi.advanceTimersByTimeAsync(15000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith("dispatcher_tick_ok");
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/secret|token|URL/);
    expect(dispatcherErrorCode({message:"EVIDENCE_CHANGED"})).toBe("DISPATCH_FAILED");
  });
  it("reports a truly pending tick but never unlocks it or starts a duplicate",async()=>{
    vi.useFakeTimers();
    let finish!:()=>void;
    const tick=vi.fn(()=>new Promise<void>(r=>{finish=r})),report=vi.fn();
    startCrewDispatcher({environment:"production",tick,observePublication:async()=>{},report});
    await vi.advanceTimersByTimeAsync(90000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("dispatcher_busy",{elapsedMs:60000});
    finish();await vi.advanceTimersByTimeAsync(15000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
