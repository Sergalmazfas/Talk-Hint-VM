import type { Pool } from "pg";
export type HintMode = "legacy" | "english-first";
export type HintModeState = { mode: HintMode; revision: number };
export function hintModeStore(getPool: () => Pick<Pool, "query"> | null) {
  return {
    async read(owner: string): Promise<HintModeState> {
      const pool = getPool(); if (!pool) throw Error("HINT_MODE_DATABASE_UNAVAILABLE");
      const result = await pool.query("SELECT hint_response_mode AS mode, hint_mode_revision AS revision FROM users WHERE id=$1", [owner]);
      const row = result.rows[0];
      if (!row || !["legacy", "english-first"].includes(row.mode) || !Number.isSafeInteger(row.revision))
        throw Error("HINT_MODE_INVALID_STATE");
      return row;
    },
    async write(owner: string, mode: HintMode, revision: number): Promise<HintModeState> {
      if (!["legacy", "english-first"].includes(mode) || !Number.isSafeInteger(revision) || revision < 0)
        throw Error("HINT_MODE_INVALID_COMMAND");
      const pool = getPool(); if (!pool) throw Error("HINT_MODE_DATABASE_UNAVAILABLE");
      const result = await pool.query(
        "UPDATE users SET hint_response_mode=$2, hint_mode_revision=hint_mode_revision+1 WHERE id=$1 AND hint_mode_revision=$3 RETURNING hint_response_mode AS mode, hint_mode_revision AS revision",
        [owner, mode, revision]);
      if (result.rows.length !== 1) throw Error("HINT_MODE_REVISION_CONFLICT");
      return result.rows[0];
    },
  };
}
