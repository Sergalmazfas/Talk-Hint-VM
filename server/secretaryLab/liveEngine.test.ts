import { describe,expect,it,vi } from "vitest";
vi.mock("./devReportArchive",()=>({devReportArchive:vi.fn()}));
import { liveBenchConfig,validateLiveBench,requireLiveDev } from "./liveEngine";
describe("Dev native Live comparison configuration",()=>{
  it("uses exact Live + feminine Marin + compact C; no Retell/tools/backend",()=>{
    const c=liveBenchConfig("This is a simulated tire-price conversation.");
    expect(c.model).toBe("gpt-live-1");expect(c.audio.output.voice).toBe("marin");
    expect(c.store).toBe(false);expect(c.delegation).toEqual({type:"client"});
    expect(c.instructions).toContain("Follow caller's RU/EN/ES");
    expect(c.instructions).toContain("No tools");
    expect(c.instructions).not.toContain("undefined");
    expect(validateLiveBench(c)).toBe(true);
    expect(validateLiveBench({...c,model:"gpt-realtime-2.1"})).toBe(false);
    expect(validateLiveBench({...c,delegation:{type:"responses"}})).toBe(false);
    expect(validateLiveBench({...c,audio:{...c.audio,output:{voice:"other"}}})).toBe(false);
  });
  it("guards the actual runtime, not only the menu",()=>{
    vi.stubEnv("NODE_ENV","production");
    expect(requireLiveDev).toThrow("LIVE_DEV_ONLY");
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","1");
    expect(requireLiveDev).toThrow("LIVE_DEV_ONLY");vi.unstubAllEnvs();
  });
});
