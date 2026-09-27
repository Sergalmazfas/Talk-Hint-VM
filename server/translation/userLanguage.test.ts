import { describe, expect, it } from "vitest";
import { getUserSubtitleLanguage, setUserSubtitleLanguage } from "./userLanguage";

describe("per-user Hint language selection", () => {
  it("keeps language updates scoped to their authenticated user", () => {
    setUserSubtitleLanguage("owner-a", "es");
    setUserSubtitleLanguage("owner-b", "ru");

    expect(getUserSubtitleLanguage("owner-a")).toBe("es");
    expect(getUserSubtitleLanguage("owner-b")).toBe("ru");
    expect(getUserSubtitleLanguage("owner-c")).toBe("ru");
    expect(getUserSubtitleLanguage()).toBe("ru");
  });
});