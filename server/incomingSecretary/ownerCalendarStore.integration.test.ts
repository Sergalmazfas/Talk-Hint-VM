import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { dbReady, isDatabaseAvailable, pool } from "../db";
import { PgOwnerCalendarStore, type CalendarGrant } from "./ownerCalendarStore";

await dbReady;
const up=isDatabaseAvailable();
const owner="calendar-test-"+randomUUID(),other="calendar-test-"+randomUUID(),number=randomUUID();
const store=new PgOwnerCalendarStore();
beforeAll(async()=>{
  if(!up)return;
  await pool!.query("INSERT INTO users(id,email) VALUES($1,$2),($3,$4)",[owner,owner+"@example.test",other,other+"@example.test"]);
  await pool!.query("INSERT INTO phone_numbers(id,user_id,twilio_number,twilio_number_sid,name,type) VALUES($1,$2,$3,$4,'Calendar test','work')",
    [number,owner,"+1555"+String(Math.floor(Math.random()*10000000)).padStart(7,"0"),"PN"+randomUUID().replaceAll("-","")]);
});
afterAll(async()=>{
  if(!up)return;
  await pool!.query("DELETE FROM phone_numbers WHERE id=$1",[number]);
  await pool!.query("DELETE FROM users WHERE id=ANY($1)",[[owner,other]]);
});
it.skipIf(!up)("persists single-use state, expiry, owner scoping, stale-grant CAS and disconnect invalidation",async()=>{
  const attempt={owner,numberId:number,secret:"encrypted-verifier"};
  const grant:CalendarGrant={owner,numberId:number,secret:"encrypted-refresh",calendarId:null,revision:randomUUID()};
  await store.begin("state-one","browser-one",attempt);
  expect(await store.consume("state-one","foreign-browser")).toBeUndefined();
  expect(await store.consume("state-one","browser-one")).toEqual(attempt);
  expect(await store.consume("state-one","browser-one")).toBeUndefined();
  expect(await store.finish("state-one",grant)).toBe(true);
  expect(await store.get(other,number)).toBeUndefined();
  expect(await store.get(owner,number)).toEqual(grant);
  expect(await store.select({...grant,owner:other},"calendar")).toBe(false);
  expect(await store.select({...grant,revision:"stale"},"calendar")).toBe(false);
  expect(await store.select(grant,"calendar")).toBe(true);
  expect((await store.get(owner,number))?.calendarId).toBe("calendar");
  await store.begin("state-two","browser-one",attempt);
  await store.consume("state-two","browser-one");
  await store.disconnect(owner,number);
  expect(await store.finish("state-two",grant)).toBe(false);
  expect(await store.get(owner,number)).toBeUndefined();
  await store.begin("expired","browser-one",attempt);
  await pool!.query("UPDATE secretary_calendar_attempts SET expires_at=now()-interval '1 second' WHERE user_id=$1",[owner]);
  expect(await store.consume("expired","browser-one")).toBeUndefined();
  expect(await store.finish("expired",grant)).toBe(false);
  await store.begin("older","browser-one",attempt);
  await store.begin("newer","browser-one",attempt);
  expect(await store.consume("older","browser-one")).toBeUndefined();
  expect(await store.consume("newer","browser-one")).toEqual(attempt);
  expect(await store.finish("newer",grant)).toBe(true);
  // Number deletion must not retain a credential or block the existing removal flow.
  await pool!.query("DELETE FROM phone_numbers WHERE id=$1",[number]);
  expect(await store.get(owner,number)).toBeUndefined();
});
