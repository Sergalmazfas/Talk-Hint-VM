/** Loopback-only, read-only screenshot fixture. NOT an app route or auth bypass. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { TeamContent } from "../client/src/pages/team";
import type { TeamView } from "../shared/team";
(globalThis as any).React = React; // tsx's standalone classic JSX runtime; Vite uses automatic JSX.
const out = "generated-artifacts/team-owner-review";
const view: TeamView = JSON.parse(await readFile(`${out}/TEAM_VIEW_FIXTURE.json`, "utf8"));
const assetRoot = "generated-artifacts/talkhint-release-candidate/dist/public/assets";
const cssFile = (await readdir(assetRoot)).find(f => /^index-.*\.css$/.test(f))!;
const css = await readFile(`${assetRoot}/${cssFile}`, "utf8");
const assets: Record<string, string> = {
  maria: "DCA4E415-0DE9-4A1B-9936-787BD9A9E06A",
  tikhon: "138C64CD-1919-47B6-9B3F-AA2A9DBF6A51",
  zamir: "1481CFC8-2CB0-4FC0-ADF7-2356C45B02FD",
  foma: "101C9081-D2C5-4F31-96C6-2687DBB45779",
  katya: "9146D4D1-803B-44D7-A521-5802546279CA",
};
for (const m of view.members) if (m.portrait) {
  const name = m.portrait.split("/")[5];
  if (assets[name]) m.portrait = `/fixture/portrait/${name}`;
}
view.source.environment = "REHEARSAL: isolated Dev copy";
const banner = `<aside style="padding:12px;text-align:center;background:#fff3cd;color:#523e13;font:600 14px system-ui">
РЕПЕТИЦИЯ НА ОТДЕЛЬНОЙ КОПИИ · не production · применение отключено</aside>`;
const pages: Record<string, string> = {};
for (const [route, member] of [["/", null], ["/maria", "head-product"], ["/foma", "lg-qa-role"]] as const) {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TalkHint — проверка интерфейса на копии</title><style>${css}</style><body>${banner}${
    renderToStaticMarkup(<TeamContent view={view} initialSelectedId={member} />)}</body></html>`;
  pages[route] = html;
  await writeFile(`${out}/preview-${member ?? "team"}.html`, html);
}
if (process.argv.includes("--serve")) createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "/";
  if (pages[url]) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(pages[url]); return; }
  const name = url.startsWith("/fixture/portrait/") ? url.slice("/fixture/portrait/".length) : "";
  if (assets[name]) {
    res.setHeader("Content-Type", "image/png");
    res.end(await readFile(`attached_assets/${assets[name]}_1793320819523.png`)); return;
  }
  res.statusCode = 404; res.end();
}).listen(5198, "127.0.0.1", () => console.log("Loopback fixture on 5198. No real application route/auth changes."));
