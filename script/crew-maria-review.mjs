import fs from "node:fs/promises";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const out = "generated-artifacts/maria-passport";
await fs.mkdir(out, { recursive: true });
const call = async (name, args = {}) => (await callProductionMcp("tools/call", { name, arguments: args })).structuredContent.result;
const tools = await callProductionMcp("tools/list");
await fs.writeFile(`${out}/tools-before.json`, JSON.stringify(tools, null, 2));
for (const name of ["get_team", "get_roadmap"]) {
  const value = await call(name);
  await fs.writeFile(`${out}/${name}-before.json`, JSON.stringify(value, null, 2));
  console.log(JSON.stringify({ read: name, revision: value.revision }));
}
for (const documentId of ["DOC-TEAM-HEAD06", "DOC-TALKHINT-PRODUCT-PASSPORT"]) {
  const value = await call("get_document", { documentId });
  await fs.writeFile(`${out}/${documentId}-before.json`, JSON.stringify(value, null, 2));
  console.log(JSON.stringify({ read: documentId, revision: value.revision, version: value.version }));
}
const chapter = await call("get_product_chapter", { mode: "hint" });
await fs.writeFile(`${out}/hint-chapter-before.json`, JSON.stringify(chapter, null, 2));
console.log(JSON.stringify({ read: "hint-chapter", revision: chapter.revision, saved: true }));
