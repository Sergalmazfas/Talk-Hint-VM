// Owner-requested, read-only production inventory. Never prints credentials.
import fs from "node:fs/promises";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const dir = "generated-artifacts/crew-stage";
await fs.mkdir(dir, { recursive: true });
const queries = ["анкета", "паспорт компании", "rev904", "самоприём", "секретарь", "Отдел кадров", "Otter"];
for (const [name, args, file] of [
  ["get_team", {}, "team-before"],
  ["get_roadmap", {}, "roadmap-before"],
  ...queries.map(query => ["search_materials", { query }, `search-${queries.indexOf(query)}`]),
]) {
  try {
    const r = await callProductionMcp("tools/call", { name, arguments: args });
    const v = r.structuredContent.result;
    await fs.writeFile(`${dir}/${file}.json`, JSON.stringify(v, null, 2));
    console.log(JSON.stringify({ file, revision: v.revision, documents: v.documents,
      nodes: v.nodes?.map(n => ({ id: n.id, code: n.code, name: n.name })),
      elements: v.elements?.map(e => ({ id: e.id, title: e.title })) }));
  } catch { console.log(JSON.stringify({ file, failed: true })); }
}
