import fs from "node:fs/promises";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const dir = "generated-artifacts/crew-stage/documents";
await fs.mkdir(dir, { recursive: true });
const index = JSON.parse(await fs.readFile("generated-artifacts/hint-team-audit/source/documents-index.json", "utf8"));
const ids = new Set(index.filter(d => /PROMPT|PORG|TEAM|BOOK|PASSPORT|COMPETITOR|BENCH-LIST/i.test(d.id)).map(d => d.id));
for (const id of ["DOC-TEAM-HEAD06", "DOC-TEAM-PPRODUCT", "DOC-TEAM-POPS", "DOC-PLAB-PROMPT-PROPOSAL"]) ids.add(id);
const queue = [...ids];
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const id = queue.shift();
    try {
      const r = await callProductionMcp("tools/call", { name: "get_document", arguments: { documentId: id } });
      const v = r.structuredContent.result;
      await fs.writeFile(`${dir}/${id}.json`, JSON.stringify(v, null, 2));
      console.log(JSON.stringify({ id, revision: v.revision, title: v.title, length: v.text.length }));
    } catch { console.log(JSON.stringify({ id, failed: true })); }
  }
}));
