import fs from "node:fs/promises";
import { callProductionMcp } from "./product-crew-production-mcp.mjs";
const dir = "generated-artifacts/secretary-structure";
await fs.mkdir(dir, { recursive: true });
const tools = await callProductionMcp("tools/list");
await fs.writeFile(`${dir}/tools.json`, JSON.stringify(tools, null, 2));
console.log(JSON.stringify({ tools: tools.tools.map(t => t.name) }));
for (const [name, args, file] of [
  ["get_team", {}, "team"],
  ["get_roadmap", {}, "roadmap"],
  ["search_materials", { query: "Секретар" }, "materials"],
]) {
  try {
    const response = await callProductionMcp("tools/call", { name, arguments: args });
    const value = response.structuredContent.result;
    await fs.writeFile(`${dir}/${file}.json`, JSON.stringify(value, null, 2));
    console.log(JSON.stringify({ read: name, revision: value.revision, saved: true }));
  } catch {
    await fs.writeFile(`${dir}/${file}-unavailable.json`, JSON.stringify({ read: name, confirmed: false }));
    console.log(JSON.stringify({ read: name, confirmed: false }));
  }
}
