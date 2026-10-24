import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { pool, isDevDatabase, dbReady } from "../../db";
import * as store from "./store";
import { initialKatya } from "./katya";
import { applyPersonality } from "./types";

// Explicitly opt in: never writes to production or runs as an ordinary unit test.
describe.skipIf(process.env.RUN_PERSONALITY_DB_TESTS !== "1")("Dev personality persistence and scale", () => {
  it("persists/re-reads owner/number bindings, pins history, retires safely and pages 1000 records", async () => {
    await dbReady;
    if (!isDevDatabase || !pool) throw new Error("Only the actual Dev database is allowed");
    const prefix = "persona-test-" + randomUUID();
    const ownerA = prefix + "-a", ownerB = prefix + "-b";
    const personal = prefix + "-personal", workA = prefix + "-work-a", workB = prefix + "-work-b";
    const before = Number((await pool.query("SELECT count(*) FROM secretary_personalities")).rows[0].count);
    const phone = () => "+1999" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
    let personalityId = "";
    try {
      await pool.query("INSERT INTO users(id,email) VALUES($1,$2),($3,$4)",
        [ownerA, ownerA + "@example.invalid", ownerB, ownerB + "@example.invalid"]);
      await pool.query(`INSERT INTO phone_numbers(id,user_id,twilio_number,name,type)
        VALUES($1,$2,$3,'TEST personal','personal'),($4,$2,$5,'TEST work A','work'),($6,$7,$8,'TEST work B','work')`,
        [personal, ownerA, phone(), workA, phone(), workB, ownerB, phone()]);
      expect(await store.readBinding(ownerA, personal)).toBeUndefined();
      const created = await store.createPersonality(prefix, initialKatya);
      personalityId = created.personality.id;
      await store.assignPersonality(ownerA, personal, personalityId, 1);
      const saved = await store.readBinding(ownerA, personal);
      expect(saved?.snapshot.name).toBe("Катя");
      expect(saved?.mode).toBe("personal");
      expect(await store.readBinding(ownerA, workA)).toBeUndefined();
      await expect(store.readBinding(ownerB, personal)).rejects.toMatchObject({ status: 404 });
      await expect(store.assignPersonality(ownerB, personal, personalityId, 1)).rejects.toMatchObject({ status: 404 });
      await store.assignPersonality(ownerA, workA, personalityId, 1);
      await store.assignPersonality(ownerB, workB, personalityId, 1);
      expect((await store.readBinding(ownerB, workB))?.mode).toBe("work");
      const revised = { ...initialKatya, rules: initialKatya.rules + "\nНовая редакция." };
      await store.revisePersonality(personalityId, 1, "available", revised);
      expect((await store.readBinding(ownerA, personal))?.snapshot.rules).toBe(initialKatya.rules);
      expect((await store.personalityDetails(personalityId)).versions.map(v => v.version)).toEqual([2, 1]);
      await expect(store.revisePersonality(personalityId, 1, "retired", revised)).rejects.toMatchObject({ status: 409 });
      await store.assignPersonality(ownerA, workA, personalityId, 2);
      expect((await store.readBinding(ownerA, workA))?.version).toBe(2);
      expect((await store.readBinding(ownerA, personal))?.version).toBe(1);
      await store.revisePersonality(personalityId, 2, "retired", revised);
      expect((await store.listPersonalities(prefix)).items).toHaveLength(0);
      const retired = await store.readBinding(ownerA, personal);
      expect(retired?.snapshot.status).toBe("retired");
      expect(applyPersonality("BASE", retired)).toContain(initialKatya.rules.slice(0, 40));
      await expect(store.assignPersonality(ownerB, workB, personalityId, 3)).rejects.toMatchObject({ status: 409 });
      await store.assignPersonality(ownerA, personal, null, null);
      expect(await store.readBinding(ownerA, personal)).toBeUndefined();
      await pool.query(`WITH made AS (
        INSERT INTO secretary_personalities(slug,name,search_name,description,current_version)
        SELECT $1||'-'||lpad(n::text,4,'0'),$1||'-'||n,$1||'-'||lpad(n::text,4,'0'),'SCALE TEST',1
        FROM generate_series(1,1000) n RETURNING id
      ) INSERT INTO secretary_personality_versions(personality_id,version,content)
        SELECT id,1,$2::jsonb FROM made`, [prefix, JSON.stringify(initialKatya)]);
      const ids = new Set<string>();
      let cursor: string | undefined, pages = 0;
      const started = performance.now();
      do {
        const page = await store.listPersonalities(prefix, cursor, 37);
        expect(page.items.length).toBeLessThanOrEqual(37);
        for (const row of page.items) { expect(ids.has(row.id)).toBe(false); ids.add(row.id); }
        cursor = page.nextCursor ?? undefined; pages++;
      } while (cursor && pages < 40);
      expect(ids.size).toBe(1000);
      expect(pages).toBe(28);
      expect((await store.listPersonalities("Кат")).items.some(p => p.slug === "katya")).toBe(true);
      console.log(`PERSONALITY_SCALE: 1000 records, ${pages} bounded pages, ${Math.round(performance.now() - started)} ms (Dev DB; not a production benchmark)`);
    } finally {
      await pool.query("DELETE FROM secretary_personality_assignments WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query(`DELETE FROM secretary_personality_versions WHERE personality_id IN
        (SELECT id FROM secretary_personalities WHERE slug LIKE $1)`, [prefix + "%"]);
      await pool.query("DELETE FROM secretary_personalities WHERE slug LIKE $1", [prefix + "%"]);
      await pool.query("DELETE FROM phone_numbers WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [[ownerA, ownerB]]);
    }
    expect(Number((await pool.query("SELECT count(*) FROM secretary_personalities")).rows[0].count)).toBe(before);
  }, 30000);
});
