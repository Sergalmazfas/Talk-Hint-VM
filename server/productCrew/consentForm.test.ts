import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { consentSubmitScript } from "./consentForm";

describe("consent submit guard", () => {
  it("allows one native submission and cancels every repeat, without fetching or auto-retrying", () => {
    let submit!: (event: { preventDefault(): void }) => void;
    const button = { disabled: false, textContent: "" };
    const status = { textContent: "" };
    const form = { addEventListener: (name: string, handler: typeof submit) => {
      expect(name).toBe("submit"); submit = handler;
    } };
    runInNewContext(consentSubmitScript, { document: {
      getElementById: (id: string) => ({
        "product-consent": form, "product-consent-submit": button,
        "product-consent-status": status,
      })[id],
    } });
    let prevented = 0;
    const event = { preventDefault() { prevented++; } };
    submit(event);
    expect(prevented).toBe(0);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Подключаем…");
    expect(status.textContent).toContain("Не отправляйте его повторно");
    submit(event); submit(event);
    expect(prevented).toBe(2);
  });
});
