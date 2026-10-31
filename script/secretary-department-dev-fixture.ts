import fs from "node:fs/promises";
import { initialModel } from "../server/projectModel/seed";
import { applyCommand } from "../server/projectModel/domain";
import { buildCompanyStructure } from "../shared/companyStructure";
import { defaultOperatingModel } from "../shared/operatingModelTemplate";
import { secretaryDepartmentRoles } from "../shared/secretaryDepartment";
import { buildTeamChange } from "../server/productCrew/teamChanges";
import { ProductCrewService, inputs } from "../server/productCrew/service";
import type { ModelRepository } from "../server/projectModel/repository";
const out = "generated-artifacts/secretary-department-tool-review/fixtures";
await fs.mkdir(out, { recursive: true });
let state = applyCommand(initialModel(), { type: "saveOperatingModel", baseVersion: 0,
  data: buildCompanyStructure(defaultOperatingModel()) }, "fixture-owner");
state.operatingModel!.revisions.at(-1)!.data.nodes.find(n => n.id === "head-product")!.managerId = "owner";
const a = inputs.create_secretary_department_structure.parse({ revision: state.revision,
  requestId: "00000000-0000-4000-8000-000000000007", reason: "OFFLINE FIXTURE ONLY",
  ownerDecisionRef: "Тест структуры, не production и не приёмка." });
for (const command of buildTeamChange(state, "create_secretary_department_structure", a).commands)
  state = applyCommand(state, command, "fixture-owner");
const repo: ModelRepository = { read: async () => structuredClone(state),
  update: async () => { throw Error("No writes"); }, updateMany: async () => { throw Error("No writes"); } };
const read = await new ProductCrewService(repo, { production: true }).call("fixture-owner", "get_team", {});
const evidence = { source: "OFFLINE_DEV_FIXTURE", productionApplied: false, productionWrites: 0 };
for (const role of secretaryDepartmentRoles) {
  const profile = JSON.parse(state.documents.find(d => d.id === `DOC-PLANNED-${role.id}`)!.text);
  await fs.writeFile(`${out}/${role.id}.json`, JSON.stringify({ ...evidence, profile,
    node: read.roles.find((r: any) => r.id === role.id) }, null, 2));
}
await fs.writeFile(`${out}/catalog.json`, JSON.stringify({ ...evidence,
  catalog: read.secretaryDepartment.catalog }, null, 2));
await fs.writeFile(`${out}/map.json`, JSON.stringify({ ...evidence,
  department: read.secretaryDepartment, projectionManagers: read.projectionManagers,
  management: secretaryDepartmentRoles.map(r => ({ roleId: r.id, managerId: r.managerId })),
  commonRolesUnchanged: ["Главный инженер", "Тихон", "Нина"] }, null, 2));
console.log(JSON.stringify({ ...evidence, roles: 3, vacancies: 2 }));
