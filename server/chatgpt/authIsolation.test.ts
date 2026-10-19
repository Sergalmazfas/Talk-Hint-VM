import { describe, expect, it, vi } from "vitest";
const getSession = vi.hoisted(() => vi.fn());
vi.mock("../storage", () => ({ storage: { getSession } }));
import { getSessionUserId } from "../auth";
describe("integration capabilities are not general application sessions", () => {
  it("rejects known marker IDs and signed credentials before querying login sessions", async () => {
    getSession.mockResolvedValue({ userId: "alice" });
    expect(await getSessionUserId("chatgpt:grant:known-marker")).toBeUndefined();
    expect(await getSessionUserId("chatgpt:token:known-marker")).toBeUndefined();
    expect(await getSessionUserId("thcg.payload.signature")).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
    expect(await getSessionUserId("regular-existing-session")).toBe("alice");
    expect(getSession).toHaveBeenCalledWith("regular-existing-session");
  });
});
