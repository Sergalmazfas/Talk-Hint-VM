# Company preview — reversible Dev sample

Protected route: `/admin/company-preview`.
Real source: existing authenticated `GET /api/admin/project-model?hypothesis=new-country`;
latest canonical operating revision, existing roles, actions, resources, links and report templates.
No new catalog, database, imported employees, writes, task launches or automatic approvals.
The route is registered only in Vite Dev; the old editor is unchanged.

## GitHub candidates checked 2026-10-26

- [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy): AGPLv3, Flutter/Rust product,
  not a drop-in React organization browser. Adopting it would require a separate
  application and data bridge; the benefit of a migration has not been established.
  [License](https://github.com/AppFlowy-IO/AppFlowy/blob/main/LICENSE)
  / [README](https://github.com/AppFlowy-IO/AppFlowy/blob/main/README.md).
- [Outline](https://github.com/outline/outline): React knowledge base; BSL 1.1
  with a restriction on a third-party commercial Document Service (checked
  license identifies version 1.12.0). Useful document navigation, but not a
  ready-made responsibility/handoff/plan-fact model. Its Koa/Sequelize server
  and Redis/Bull infrastructure differ from this project's server.
  [License](https://github.com/outline/outline/blob/main/LICENSE)
  / [Architecture](https://github.com/outline/outline/blob/main/docs/ARCHITECTURE.md).
- Selected for this sample: the **already installed shadcn/Radix React UI
  foundation** ([shadcn/ui, MIT](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)),
  specifically the existing `ui/button` component and its Radix
  Slot dependency, plus installed lucide icons. Native disclosure and browser
  history avoid another navigation/editor framework. No external application
  code, installation or storage migration is claimed.

## Cost boundary

Neither candidate's source availability means zero hosting or maintenance cost.
Self-hosting needs compute, persistence, backups, auth/integration and updates;
Outline also has Redis/queue operations. Hosted prices and exact capacity have
not been measured or quoted. This sample adds no subscription, service, model
call, worker or new hosting instance, and uses existing Dev infrastructure.
Incremental performance and operating cost are not measured.

## Checks and scope

`NODE_ENV=development npx tsx scripts/check-company-preview.ts` runs the actual
component with a freshly read canonical Dev snapshot in a localhost-only browser
fixture. It checks drilldown, deep links, back, recovery, disclosures, narrow
widths and read-only behavior. Generated screenshots are ignored artifacts.
This is **not verification of the signed-in admin page**. Real app access keeps
the existing server owner check and client AdminGate; never bypass auth for a preview.
No KPI, actual execution, staff availability or acceptance is inferred from role
descriptions. Plan-fact meetings and a complete organization redesign are outside
this first sample.

Removal is limited to the new route/import, page and this component folder; no
model rollback or data deletion is needed.
