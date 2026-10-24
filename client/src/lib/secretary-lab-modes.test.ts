import { describe, expect, it } from "vitest";
import { secretaryStand, secretaryStandPath, retellStandApi, chooseSecretaryStand, type SecretaryStand } from "./secretary-lab-modes";
describe("Three Secretary browser stands", () => {
  const modes: SecretaryStand[] = ["gpt", "retell", "retell-engine"];
  it.each(modes)("deep links and refresh restore exactly %s without substituting another mode", mode => {
    const path = secretaryStandPath(mode);
    expect(secretaryStand(path.slice(path.indexOf("?")))).toBe(mode);
    expect(path).not.toContain("/admin/admin");
  });
  it("retains separate Retell APIs, never the managed LLM route for Engine", () => {
    expect(retellStandApi("retell")).toBe("/api/admin/secretary-lab/retell");
    expect(retellStandApi("retell-engine")).toBe("/api/admin/secretary-lab/retell-engine");
  });
  it("permits idle switching and refuses switching while starting, live, or stop is unconfirmed", () => {
    for (const a of modes) for (const b of modes) {
      expect(chooseSecretaryStand(a, b, false)).toBe(b);
      expect(chooseSecretaryStand(a, b, true)).toBe(a);
    }
  });
  it("unknown/missing mode uses the existing GPT stand", () => {
    expect(secretaryStand("")).toBe("gpt");
    expect(secretaryStand("?stand=other")).toBe("gpt");
  });
});
