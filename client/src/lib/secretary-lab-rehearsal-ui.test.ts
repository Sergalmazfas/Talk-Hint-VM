import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RehearsalVersion } from "@shared/rehearsal";
import { RehearsalComposer, assignmentPresets, rehearsalAssignmentPresets } from "./rehearsal-composer";
import { defaultRehearsalScenes, sceneFromText } from "../../../server/rehearsal/catalog";

const versions: RehearsalVersion[] = [
  { id: "production-C", label: "Как в бою (C)", source: "production-profile-code", hash: "prod-hash", available: true, productionVerified: false },
  { id: "dev-C", label: "Новая (Dev)", source: "dev-C", hash: "dev-hash", available: true, productionVerified: false },
];

describe("owner rehearsal composer", () => {
  it("renders a compact owner-only phone composer with one textarea, two versions and one Call action", () => {
    const html = renderToStaticMarkup(createElement(RehearsalComposer, {
      assignment: "Позвони продавцу и спроси про комплект шин.",
      onAssignmentChange: () => undefined,
      versionId: "dev-C",
      versions,
      selectedVersion: versions[1],
      onVersionChange: () => undefined,
      consentGranted: true,
      readyToStart: true,
      pending: false,
      busy: false,
      active: null,
      uncertain: false,
      onStart: () => undefined,
      onStop: () => undefined,
      onOpenMore: () => undefined,
    }));

    expect((html.match(/<textarea\b/g) ?? [])).toHaveLength(1);
    expect(html).toContain('id="production-C"');
    expect(html).toContain("Как в бою (C)");
    expect(html).toContain('id="dev-C"');
    expect(html).toContain("Новая (Dev)");
    expect((html.match(/class="primary-button call-button"/g) ?? [])).toHaveLength(1);
    expect(html).toContain("Позвонить");
    expect(html).not.toMatch(/Подсказчик|Hint|executor.{0,8}hint/i);
  });

  it("uses the owner's real truck rehearsal subjects, not invented car-sale scenes", () => {
    expect(Object.keys(assignmentPresets)).toEqual(["Шины", "Парковка", "Мойка"]);
    const presets = rehearsalAssignmentPresets(defaultRehearsalScenes());
    expect(presets.Шины).toContain("295/75R22.5");
    expect(presets.Шины).toContain("$400");
    expect(assignmentPresets.Парковка).toContain("тягача на одну ночь");
    expect(assignmentPresets.Мойка).toContain("тягача и трейлера");
    for (const text of [presets.Парковка, presets.Мойка]) expect(text).toMatch(/не платить/i);
    expect(presets.Шины).toContain("No payment");
  });
  it("the Tires button sends the exact authenticated plan through the real preparation parser, with no stale quote-only text", () => {
    const scenes = defaultRehearsalScenes(), onAssignmentChange = vi.fn();
    const tree = RehearsalComposer({
      scenes, assignment: "", onAssignmentChange, versionId: "dev-C", versions,
      selectedVersion: versions[1], onVersionChange: () => {}, consentGranted: true,
      readyToStart: true, pending: false, busy: false, active: null, uncertain: false,
      onStart: () => {}, onStop: () => {}, onOpenMore: () => {},
    });
    const row = (tree.props.children as any[]).find(node => node?.props?.["aria-label"] === "Примеры поручений");
    const button = row.props.children.find((node: any) => node.key === "Шины");
    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    const text = onAssignmentChange.mock.calls[0][0];
    const submitted = sceneFromText("submitted", { text });
    expect(submitted.plan).toEqual(scenes[0].plan);
    for (const phrase of ["TODAY", "two hours", "$400", "one hour", "British Petroleum", "96257"])
      expect(text).toContain(phrase);
    const phone = scenes[0].plan.expectedQuestions.find(q => q.q === "Booking phone number?")!.answer!;
    expect(submitted.plan.ownerFacts.join(" ")).toContain(phone.replace(/\.$/, ""));
    expect(text).not.toContain("Не бронировать, не заказывать");
    expect(assignmentPresets.Шины).toBe("");
    expect(rehearsalAssignmentPresets([]).Шины).toBe("");
  });

  it("keeps the main mobile viewport bounded and lets the assignment field scroll internally", () => {
    const css = readFileSync(fileURLToPath(new URL("./rehearsal.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.rehearsal-shell\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.rehearsal-shell textarea\.assignment-input\s*\{[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/\.more-drawer\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*auto/s);
  });
});
