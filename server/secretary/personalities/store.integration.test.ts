import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { pool, isDevDatabase, dbReady } from "../../db";
import * as store from "./store";
import { initialKatya } from "./katya";
import { applyPersonality } from "./types";
import { assertOutgoingRetryLine, prepareOutgoingContext, saveOutgoingSetup, validateOutgoingSnapshot } from "./outgoing";

// Explicitly opt in: never writes to production or runs as an ordinary unit test.
describe.skipIf(process.env.RUN_PERSONALITY_DB_TESTS !== "1")("Dev personality persistence and scale", () => {
  it("persists/re-reads owner/number bindings, pins history, retires safely and pages 1000 records", async () => {
    await dbReady;
    if (!isDevDatabase || !pool) throw new Error("Only the actual Dev database is allowed");
    vi.stubEnv("NODE_ENV", "development");
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
      await pool.query(`INSERT INTO knowledge_cards(id,user_id,card_type,title,body,profile_scope)
        VALUES($1,$2,'other','Owner facts','Owner prefers English.','personal'),
              ($3,$2,'other','Work facts','Office opens at 9.','work'),
              ($4,$5,'other','Other owner','Private other owner facts.','personal')`,
        [prefix + "-cp", ownerA, prefix + "-cw", prefix + "-cb", ownerB]);
      await expect(saveOutgoingSetup(ownerA, personal, { personalityId, version: 1, cardIds: [prefix + "-cw"] })).rejects.toMatchObject({ status: 409 });
      await expect(saveOutgoingSetup(ownerA, personal, { personalityId, version: 1, cardIds: [prefix + "-cb"] })).rejects.toMatchObject({ status: 409 });
      await saveOutgoingSetup(ownerA, personal, { personalityId, version: 1, cardIds: [prefix + "-cp"] });
      const context = (await prepareOutgoingContext(ownerA, personal, "retell"))!;
      expect(context.personality?.snapshot.name).toBe("Катя");
      expect(context.cards.map(c => c.id)).toEqual([prefix + "-cp"]);
      expect(context.scope).toBe("personal");
      expect(() => assertOutgoingRetryLine(context, personal)).not.toThrow();
      expect(() => assertOutgoingRetryLine(context, workA)).toThrow();
      expect(() => assertOutgoingRetryLine(null, personal)).toThrow();
      expect(() => assertOutgoingRetryLine(null, undefined)).not.toThrow();
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query(`INSERT INTO secretary_tasks(id,user_id,phone_number,instruction,voice_provider,status,notification_status,outgoing_context)
          VALUES($1,$2,'+19990000000','TEST only','retell','completed','sent',$3::jsonb)`,
          [prefix + "-task", ownerA, JSON.stringify(context)]);
        const reread = await connection.query("SELECT outgoing_context FROM secretary_tasks WHERE id=$1", [prefix + "-task"]);
        expect(reread.rows[0].outgoing_context.numberId).toBe(personal);
        expect(reread.rows[0].outgoing_context.personality.version).toBe(1);
        expect(reread.rows[0].outgoing_context.cardIds).toEqual([prefix + "-cp"]);
      } finally {
        await connection.query("ROLLBACK"); connection.release(); // Never visible to workers or notifications.
      }
      expect((await validateOutgoingSnapshot(ownerA, context)).numberId).toBe(personal);
      await expect(prepareOutgoingContext(ownerB, personal, "retell")).rejects.toMatchObject({ status: 404 });
      await expect(prepareOutgoingContext(ownerA, personal, "openai")).rejects.toMatchObject({ status: 409 });
      await saveOutgoingSetup(ownerA, personal, { personalityId, version: 1, cardIds: [] });
      await expect(validateOutgoingSnapshot(ownerA, context)).rejects.toMatchObject({ status: 409 });
      await saveOutgoingSetup(ownerA, personal, { personalityId, version: 1, cardIds: [prefix + "-cp"] });
      await pool.query("UPDATE knowledge_cards SET body='Changed facts.' WHERE id=$1", [prefix + "-cp"]);
      await expect(validateOutgoingSnapshot(ownerA, context)).rejects.toMatchObject({ status: 409 });
      await pool.query("UPDATE knowledge_cards SET body='Owner prefers English.' WHERE id=$1", [prefix + "-cp"]);
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
      expect((await validateOutgoingSnapshot(ownerA, context)).personality?.version).toBe(1);
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
      await pool.query("DELETE FROM secretary_outgoing_settings WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query("DELETE FROM knowledge_cards WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query("DELETE FROM secretary_personality_assignments WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query(`DELETE FROM secretary_personality_versions WHERE personality_id IN
        (SELECT id FROM secretary_personalities WHERE slug LIKE $1)`, [prefix + "%"]);
      await pool.query("DELETE FROM secretary_personalities WHERE slug LIKE $1", [prefix + "%"]);
      await pool.query("DELETE FROM phone_numbers WHERE user_id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [[ownerA, ownerB]]);
      vi.unstubAllEnvs();
    }
    expect(Number((await pool.query("SELECT count(*) FROM secretary_personalities")).rows[0].count)).toBe(before);
  }, 30000);
});
