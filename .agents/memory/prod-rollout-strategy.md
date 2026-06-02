---
name: Production rollout / DB schema strategy
description: How prod schema and Twilio signature trust are handled for the deployed app; why prod-migrate.ts is NOT the path.
---

# Production rollout strategy

**Deployment is Reserved VM with Replit-managed PostgreSQL** (`.replit` deploymentTarget=vm, `PROD_DATABASE_URL` unset). So the production DB is a SEPARATE managed PG, and its schema is applied by the **Publish flow** (Replit diffs dev→prod on publish), NOT by any script.

- **Do NOT run/extend `scripts/prod-migrate.ts`** to migrate prod. It is the external-Neon/Autoscale path (`server/db.ts` prefers `PROD_DATABASE_URL` when set). It is unused for the Reserved VM path, and the database skill forbids custom prod-migration scripts / direct DDL / startup self-heal for managed PG.
- **How new tables/columns reach prod:** put them in the schema source of truth (`shared/schema.ts`), ensure the dev DB matches, verify in dev, then re-publish. The publish diff carries them over. (e.g. `pending_calls.client_type`, `device_tokens` were already in schema + dev DB.)
- `server/db.ts` `CREATE_TABLES_SQL` is a legacy startup self-heal that is out of sync with the schema (missing pending_calls/device_tokens/etc.) — do not rely on or extend it.

## Twilio signature verification (security)
- `DISABLE_TWILIO_SIGNATURE_CHECK` is force-ignored when `NODE_ENV==="production"` (see `server/routes.ts`): the disable flag can only relax the check in non-prod. The conference-join trust boundary (`/twilio/voice` trusting `From=client:user-{id}`) depends on this — prod must always verify signatures.

## Post-publish operational steps (user-driven, not doable from a task agent)
1. Publish (creates prod DB + applies schema).
2. Repoint Twilio voice/status webhooks to the live URL via `scripts/configure-twilio-webhooks.ts` (prod URL overridable via `PRODUCTION_URL` env). Note: its `--production` flag also reads the number pool from `PROD_DATABASE_URL`, which doesn't fit the Reserved VM internal-DB model — known gap.
