# Dev competitor support import: executed and verified

Checked: 25 October 2026. No production changes, publication, purchases or support contacts.

The public support profiles are **already saved in the existing Dev owner's
new-country competitor snapshots**, not just exported as code. The initial
explicit owner-scoped import updated five cards and moved the root revision
from 614 to 619. All earlier revisions, other hypotheses, other blocks,
research and the unselected primary hypothesis were preserved.

A second explicit import and a separate read-only verification were run against
the real Dev PostgreSQL database:

```sh
NODE_ENV=development DISABLE_AUTO_WEBHOOK_REPOINT=true npx tsx \
  server/projectModel/research/importPublicSupport.ts --apply --owner EXISTING_OWNER
NODE_ENV=development DISABLE_AUTO_WEBHOOK_REPOINT=true npx tsx \
  server/projectModel/research/importPublicSupport.ts --verify --owner EXISTING_OWNER
```

`EXISTING_OWNER` is a placeholder, not a new account or a request for a key.
The commands were executed with the existing owner's identifier; no identity,
credentials, connection string or full owner model is reproduced here.

Repeat import output: `changed: 0`, `revision: 619`,
`completeReadback: true`, `otherMaterialsPreserved: true`.
The separate read-only process verified exact semantic equality between each
stored profile and the checked source dataset:

| Existing card | Saved card version | Support fields | Source check date | Personal checks | Readback |
|---|---:|---:|---|---:|---|
| VocaLingo | 3 | 9 | 2026-10-25 | 0 | matches |
| Lingvanex — Phone Call Translator | 3 | 9 | 2026-10-25 | 0 | matches |
| AI Call — TaraAI | 2 | 9 | 2026-10-25 | 0 | matches |
| AI Phone | 3 | 9 | 2026-10-25 | 0 | matches |
| Guardianly | 2 | 9 | 2026-10-25 | 0 | matches |

Nine fields does not mean nine known facts. Unknown hours, languages, CRM or
tools remain null with status, date and explanation. No personal scores were
invented. The official source URLs and confidence are in each saved field.

## Delivery and test boundaries

- The app reads the saved profiles via the existing authenticated
  `/api/admin/project-model?hypothesis=new-country` route.
- The route test “imports all five support profiles into the SAME owner
  repository…” exercises import, SQL JSON round-trip, authenticated API reload
  of every profile, repeat-run idempotence, new repository/app instance,
  cross-owner isolation and protection of subsequent manual changes.
  **That HTTP test uses a mock SQL boundary and mock authentication**; it does
  not pretend to be a signed-in browser check against the live Dev app.
- The actual Dev DB import and full readback above use the real PostgreSQL pool.
- An unauthenticated real API request returns 401. Screenshot reaches the
  existing administrator sign-in page. No authentication bypass was added;
  the signed-in screen and mobile interactions were not visually verified.
- Tests, type checking and a local frontend bundle build are separate checks,
  not publication. Source data must not be written at server startup.

The CLI is explicit and Dev-only. A repeat with matching data is a no-op.
If existing support fields have since been manually changed, import stops for
manual reconciliation instead of replacing them. The UI can still update
public sources through the existing versioned save action.
