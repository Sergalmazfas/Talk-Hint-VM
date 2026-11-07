import { describe, expect, it } from "vitest";
import { nativeChatDevRequested, nativeReturnScheme } from "./nativeChatDev";

describe("isolated native Dev OAuth", () => {
  it("keeps existing native login unchanged", () => {
    expect(nativeChatDevRequested(undefined, "production")).toBe(false);
    expect(nativeReturnScheme(undefined, "production")).toBe("talkhint");
    expect(nativeReturnScheme(false, "development")).toBe("talkhint");
  });
  it("only permits the fixed client in explicit development", () => {
    expect(nativeChatDevRequested("chatdev", "development")).toBe(true);
    for (const env of ["production", "test", undefined]) {
      expect(() => nativeChatDevRequested("chatdev", env)).toThrow("NATIVE_DEV_LOGIN_UNAVAILABLE");
      expect(nativeReturnScheme(true, env)).toBe("talkhint");
    }
  });
  it("rejects arbitrary schemes, URLs and ambiguous query parameters", () => {
    for (const value of ["evil://auth", "talkhint", ["chatdev"], "", null, {}]) {
      expect(() => nativeChatDevRequested(value, "development")).toThrow();
    }
  });
  it("requires the exact server-session marker, never a query/cookie string", () => {
    expect(nativeReturnScheme(true, "development")).toBe("talkhint-chatdev");
    for (const value of ["true", "chatdev", 1, undefined, null]) {
      expect(nativeReturnScheme(value, "development")).toBe("talkhint");
    }
  });
});
