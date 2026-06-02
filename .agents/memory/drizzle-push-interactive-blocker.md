---
name: drizzle-kit push interactive blocker
description: Why drizzle-kit push can hang/block in this repo and the safe workaround.
---

# drizzle-kit push prompts interactively and blocks

`npm run db:push` (drizzle-kit push) can stop on an interactive prompt asking to
"create or rename" a table — in this repo it offered to rename an out-of-schema
`user_sessions` table. This blocks non-interactive automation.

- **Do NOT accept the rename** — it would clobber existing data for a table that
  simply isn't described in `shared/schema.ts`.
- **Workaround:** apply the new table/column DDL directly (e.g. via `executeSql`
  in the code-execution sandbox), then re-run `db:push` — it then reports in-sync.
- **Why:** there are live DB objects not mirrored in the Drizzle schema, so push
  treats them as candidates for rename. Adding additive objects by hand sidesteps
  the prompt without touching the unrelated tables.
