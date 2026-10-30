/** Offline review artifacts. No database/provider access, grants or model writes. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { TeamContent } from "../client/src/pages/team";
import { proposeExternalPartners, withExternalPartners, EXTERNAL_PARTNERS_DOCUMENT } from "../server/team/external";
import { withTeamRuntime } from "../server/team/runtime";
import type { TeamView } from "../shared/team";
(globalThis as any).React = React;
const out = "generated-artifacts/team-package-two";
await mkdir(out, { recursive: true });
const original: TeamView = JSON.parse(await readFile("generated-artifacts/team-owner-review/TEAM_VIEW_FIXTURE.json", "utf8"));
if (original.source.revision !== 918 ||
    original.source.rootHash !== "af8fc455ef7fd387cbf368036f1ef5b9fd367e013430f1851da7d83f4a824297")
  throw Error("Retained source does not match reviewed r918");
const proposed = proposeExternalPartners(original);
const members = proposed.members.filter(m => m.kind === "external" || m.id.startsWith("studio-") || m.id === "head-engineering");
const document = { id: EXTERNAL_PARTNERS_DOCUMENT, title: "Внешние партнёры и покрытие должностей",
  text: JSON.stringify({ schema: 1, members }, null, 2), url: "", elementIds: [], updatedAt: new Date().toISOString() };
await writeFile(`${out}/PARTNERS_PROPOSED_DOCUMENT.json`, JSON.stringify({
  status: "PROPOSED_ONLY_NOT_APPLIED", expected: { ...original.source, environment: "production",
    workspace: "company-import-7cf8767b-fbeb-4e97-939f-cc2c3767cf3a", phase: "active" },
  hypothesis: "new-country", document,
}, null, 2));
// Validate the proposed PG document through the real reader before presentation.
withExternalPartners(original, document.text);
const at = "2026-10-30T00:00:00.000Z";
const c: any = { owner: "FIXTURE_OWNER", jobs: [{ updated_at: at, report: { mode: "hint",
  call_id: "FIXTURE_CALL", analysis: {}, qa_status: "QA: принято" } }], controls: [],
  secretaryDefault: "retell", secretaryTasks: [{ id: "FIXTURE_TASK", user_id: "FIXTURE_OWNER",
    voice_provider: "retell", call_sid: "FIXTURE_SECRETARY_CALL", instruction: "Стендовый пример поручения — не реальный звонок",
    dial_started_at: at, updated_at: at, call_ended_at: at, call_metadata: {} }] };
const fixture = withExternalPartners(withTeamRuntime(original, c, { now: Date.parse(at) + 1000,
  watchdog: { state: "checked", checkedAt: at, activeIncidents: 0 },
  secretaryPrompt: { text: "СТЕНДОВЫЙ ПРИМЕР. Это не production-промпт и не реальный звонок.",
    version: "fixture", source: "Явный тестовый пример", model: "fixture-only", traits: [null, null, null],
    motto: null, name: "Катя" } }), document.text);
fixture.source.environment = "FIXTURE — NOT PRODUCTION";
fixture.apply.available = false; fixture.apply.pin = null;
const assets: Record<string, string> = {
  maria: "DCA4E415-0DE9-4A1B-9936-787BD9A9E06A_1793320819523.png",
  tikhon: "138C64CD-1919-47B6-9B3F-AA2A9DBF6A51_1793320819523.png",
  zamir: "1481CFC8-2CB0-4FC0-ADF7-2356C45B02FD_1793320819523.png",
  foma: "101C9081-D2C5-4F31-96C6-2687DBB45779_1793320819523.png",
  katya: "9146D4D1-803B-44D7-A521-5802546279CA_1793320819523.png",
  klavdiy: "8168E690-E22D-4E02-95E7-70587B5D2800_1793326152428.png",
  efim: "497258E9-630F-4334-9E3A-44549FA2F044_1793326152428.png",
};
for (const m of fixture.members) if (m.portrait) {
  const name = m.portrait.split("/")[5];
  if (assets[name]) m.portrait = `/fixture/portrait/${name}`;
}
const assetRoot = "generated-artifacts/talkhint-release-candidate/dist/public/assets";
const cssFile = (await readdir(assetRoot)).find(f => /^index-.*\.css$/.test(f));
if (!cssFile) throw Error("Run build:prepare first");
const css = await readFile(`${assetRoot}/${cssFile}`, "utf8");
const pages: Record<string, string> = {};
for (const [route, selected] of [["/", null], ["/katya", "employee-katya"], ["/klavdiy", "external-klavdiy"]] as const) {
  const view = structuredClone(fixture);
  if (route === "/") view.members = view.members.filter(m =>
    ["P.LAB", "P.LG.QA", "P.OPS", "SECRETARY", "CLAUDE", "REPLIT"].includes(m.code));
  pages[route] = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><aside style="padding:12px;background:#fff3cd;text-align:center">ИЗОЛИРОВАННЫЙ СТЕНД · факты и промпт здесь тестовые · без API и записи</aside>${renderToStaticMarkup(<TeamContent view={view} initialSelectedId={selected} />)}</body></html>`;
  await writeFile(`${out}/preview-${selected ?? "team"}.html`, pages[route]);
}
console.log("Draft document prepared, validated, NOT APPLIED. Isolated UI fixtures ready.");
if (process.argv.includes("--serve")) createServer(async (req, res) => {
  const path = req.url?.split("?")[0] ?? "/";
  if (pages[path]) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(pages[path]); return; }
  const name = path.startsWith("/fixture/portrait/") ? path.slice("/fixture/portrait/".length) : "";
  if (assets[name]) { res.setHeader("Content-Type", "image/png"); res.end(await readFile(`attached_assets/${assets[name]}`)); return; }
  res.statusCode = path === "/favicon.ico" ? 204 : 404; res.end();
}).listen(8099, "127.0.0.1", () => console.log("Loopback fixture: 8099; no app routes/auth changes."));
