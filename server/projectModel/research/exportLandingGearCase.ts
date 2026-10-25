/** Read the canonical owner-scoped Dev document and produce a static export, not another store. */
import { mkdir, writeFile } from "node:fs/promises";
import { dbReady, isDevDatabase, pool } from "../../db";
import { landingGearDocumentTitle } from "./landingGearCaseContent";
import { crewRoadmapTitle } from "./crewRoadmapContent";
import { crewSetupTitle } from "./crewSetup";
import { productCrewGuideTitle } from "../../productCrew/setup";
import { readHypothesis } from "../hypotheses";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function inline(text: string) {
  return escape(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/https:\/\/[^\s<]+/g, url => `<a href="${url}" rel="noreferrer">${url}</a>`);
}
function render(text: string) {
  const lines = text.split("\n"), result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) { result.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[-: |]+\|$/)) {
      const cells = (row: string, tag: string) => row.split("|").slice(1, -1).map(cell => `<${tag}>${inline(cell.trim())}</${tag}>`).join("");
      let table = `<div class="table-scroll"><table><thead><tr>${cells(line, "th")}</tr></thead><tbody>`;
      i++;
      while (lines[i + 1]?.startsWith("|")) table += `<tr>${cells(lines[++i], "td")}</tr>`;
      result.push(table + "</tbody></table></div>"); continue;
    }
    result.push(`<p>${inline(line)}</p>`);
  }
  return result.join("\n");
}
async function main() {
  if (process.env.NODE_ENV !== "development" || !isDevDatabase) throw new Error("Dev only");
  await dbReady; if (!pool) throw new Error("Database unavailable");
  const { rows } = await pool.query(`SELECT state FROM talkhint_project_models WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a WHERE a->>'id'='new-country')`);
  if (rows.length !== 1) throw new Error("Ambiguous owner; no export");
  const roadmap = process.argv.includes("--crew-roadmap");
  const setup = process.argv.includes("--crew-setup");
  const product = process.argv.includes("--product-crew");
  const doc = readHypothesis(rows[0].state, "new-country").documents.find(d => d.title === (product ? productCrewGuideTitle : setup ? crewSetupTitle : roadmap ? crewRoadmapTitle : landingGearDocumentTitle));
  if (!doc) throw new Error("Saved case document not found");
  const folder = roadmap || setup || product ? "generated-artifacts/crew-roadmap" : "generated-artifacts/landing-gear-case";
  const filename = product ? "talkhint-product-crew-connection-v1" : setup ? "talkhint-crew-roadmap-v2" : roadmap ? "talkhint-crew-roadmap-v1" : "talkhint-landing-gear-v1";
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/${filename}.md`, doc.text);
  await writeFile(`${folder}/${filename}.html`, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(doc.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f7f7;color:#193133;font:16px/1.65 system-ui,-apple-system,sans-serif}
main{max-width:1200px;margin:24px auto;background:white;padding:38px;border-radius:16px}header{color:#496063;border-bottom:1px solid #dce6e5;padding-bottom:18px}
h1{font-size:30px;line-height:1.25}h2{margin-top:38px;color:#145c55;font-size:23px}h3{font-size:18px;margin-top:26px}p{overflow-wrap:anywhere}
a{color:#09645a}table{border-collapse:collapse;width:100%;font-size:14px;min-width:700px}th,td{text-align:left;vertical-align:top;padding:13px;border:1px solid #dce6e5}th{background:#edf6f3}.table-scroll{overflow:auto;margin:20px 0}
@media(max-width:600px){main{margin:0;padding:20px;border-radius:0}h1{font-size:25px}}@media print{body{background:white}main{margin:0;padding:0}.table-scroll{overflow:visible}table{min-width:0;font-size:10px}a{overflow-wrap:anywhere}}
</style><main><header>Версия ${setup ? 2 : 1} · Для обсуждения · 25 октября 2026<br>Экспорт сохранённого документа Dev. Команда и внешние действия не запускались.</header>${render(doc.text)}</main></html>`);
  console.log(JSON.stringify({ exported: true, characters: doc.text.length, source: "saved Dev model", folder }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Export failed"); process.exitCode = 1; }).finally(async () => { await pool?.end(); });
