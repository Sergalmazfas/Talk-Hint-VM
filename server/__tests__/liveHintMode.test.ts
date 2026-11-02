import { describe, it, expect } from "vitest";
import { hintModeStore } from "../liveHintMode";
describe("persistent per-owner mode / CAS rollback", () => {
  it("defaults old, switches, rejects stale writes and rolls back without a restart", async () => {
    let mode = "legacy", revision = 0;
    const s = hintModeStore(() => ({ query: async (sql: string, p: any[]) => {
      expect(p[0]).toBe("owner");
      if (sql.startsWith("UPDATE")) {
        if (p[2] !== revision) return { rows: [] };
        mode = p[1]; revision++;
      }
      return { rows: [{ mode, revision }] };
    } }) as any);
    expect(await s.read("owner")).toEqual({ mode: "legacy", revision: 0 });
    expect(await s.write("owner", "english-first", 0)).toEqual({ mode: "english-first", revision: 1 });
    await expect(s.write("owner", "legacy", 0)).rejects.toThrow("CONFLICT");
    expect(await s.write("owner", "legacy", 1)).toEqual({ mode: "legacy", revision: 2 });
  });
  it("database failure never enables new mode", async () => {
    await expect(hintModeStore(() => null).read("owner")).rejects.toThrow("UNAVAILABLE");
  });
});
