import {beforeAll,afterAll,beforeEach,describe,it,expect} from "vitest";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {assignProfiles} from "./assign";
const suite=process.env.RUN_NUMBER_SETUP_DB_TESTS==="1"?describe:describe.skip;
suite("isolated Dev PostgreSQL accounts and SYNTHETIC numbers; never Twilio",()=>{
  let root:Pool,db:Pool;
  const schema="number_setup_test_"+randomUUID().replaceAll("-","");
  const inspect=async()=>({foundOnMain:true,voiceEnabled:true,voiceUrl:"https://talkhint.app/twilio/voice",
    statusCallback:"https://talkhint.app/twilio/status",voiceMethod:"POST",usesVoiceApplication:false});
  beforeAll(async()=>{
    const runtime=await import("../db");await runtime.dbReady;
    if(!runtime.isDevDatabase||!runtime.pool)throw new Error("Dev database required");
    root=runtime.pool;
    await root.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.users(id varchar PRIMARY KEY,plan text);
      CREATE TABLE ${schema}.available_numbers(id varchar PRIMARY KEY,twilio_number text UNIQUE,twilio_sid text,is_assigned boolean DEFAULT false);
      CREATE TABLE ${schema}.phone_numbers(id varchar PRIMARY KEY DEFAULT gen_random_uuid(),user_id varchar REFERENCES ${schema}.users(id),
        twilio_number text UNIQUE,twilio_number_sid text,name text,type text,created_at timestamp DEFAULT now());
      CREATE TABLE ${schema}.user_prompts(id varchar DEFAULT gen_random_uuid(),user_id varchar,phone_number_id varchar,name text,content text,is_active boolean);
      CREATE TABLE ${schema}.incoming_secretary_dev_requests(call_sid varchar UNIQUE,id varchar,user_id varchar REFERENCES ${schema}.users(id),
        number_id varchar REFERENCES ${schema}.phone_numbers(id),payload jsonb,notification_status text DEFAULT 'not_applicable',updated_at timestamp DEFAULT now());`);
    db=new Pool({...root.options,options:`-c search_path=${schema}`,max:5});
  });
  afterAll(async()=>{
    if(db)await db.end();
    if(root){await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root.end();}
  });
  beforeEach(async()=>{
    await db.query("TRUNCATE user_prompts,phone_numbers,available_numbers,users CASCADE");
    await db.query("INSERT INTO users VALUES('alice','basic'),('bob','basic'),('carol','basic'),('free','free')");
    for(let i=0;i<6;i++)await db.query("INSERT INTO available_numbers(id,twilio_number,twilio_sid) VALUES($1,$2,$3)",
      ["fixture-"+i,"+1555000000"+i,"SYNTHETIC-NOT-A-PROVIDER-SID"]);
  });
  it("covers frames-only, Work-only without personal, and a two-number account",async()=>{
    const a=await assignProfiles(db,"alice","frames",inspect);
    const b=await assignProfiles(db,"bob","work",inspect);
    const c=await assignProfiles(db,"carol","both",inspect);
    expect(a.phoneNumbers.map(n=>n.type)).toEqual(["personal"]);
    expect(b.phoneNumbers.map(n=>n.type)).toEqual(["work"]);
    expect(c.phoneNumbers.map(n=>n.type).sort()).toEqual(["personal","work"]);
    expect(new Set([...a.phoneNumbers,...b.phoneNumbers,...c.phoneNumbers].map(n=>n.phoneNumber)).size).toBe(4);
  });
  it("persists an isolated browser request with no phone number and no notification",async()=>{
    const {IncomingStore}=await import("../incomingSecretary/store");
    const {IntakeSession}=await import("../incomingSecretary/session");
    const {defaults}=await import("../incomingSecretary/policy");
    const store=new IncomingStore("incoming_secretary_dev_requests",db);
    const session=new IntakeSession("alice","synthetic-browser-only",defaults("dev-sandbox"),store);
    const before=await session.begin();
    await session.save({name:"Ana",phone:"+15550000001",callbackConfirmed:true,language:"es",notes:"¿Hay clases de arte?",reviewed:true},true);
    await session.end("completed");
    expect((await session.begin()).id).toBe(before.id);
    const rows=await db.query("SELECT number_id,notification_status,payload FROM incoming_secretary_dev_requests");
    expect(rows.rowCount).toBe(1);expect(rows.rows[0]).toMatchObject({number_id:null,notification_status:"not_applicable",
      payload:{testOnly:true,numberId:"dev-sandbox",status:"pending_owner"}});
    expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(0);
    await expect(store.begin("bob","dev-sandbox","synthetic-browser-only")).rejects.toThrow("ownership");
    await expect(store.update("bob","synthetic-browser-only",r=>r)).rejects.toThrow("not found");
  });
  it("reuses assignments under concurrent duplicate requests and preserves existing data",async()=>{
    const results=await Promise.all([assignProfiles(db,"alice","both",inspect),assignProfiles(db,"alice","both",inspect)]);
    expect(results[0].phoneNumbers.map(n=>n.id).sort()).toEqual(results[1].phoneNumbers.map(n=>n.id).sort());
    await db.query("UPDATE phone_numbers SET name='Existing custom name' WHERE user_id='alice' AND type='personal'");
    const again=await assignProfiles(db,"alice","both",inspect);
    expect(again.reused).toBe(true);expect(again.phoneNumbers.some(n=>n.name==="Existing custom name")).toBe(true);
    expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(2);
  });
  it("allocates only the missing purpose when upgrading from one to two",async()=>{
    const old=await assignProfiles(db,"alice","work",inspect);
    const pair=await assignProfiles(db,"alice","both",inspect);
    expect(pair.phoneNumbers).toHaveLength(2);expect(pair.phoneNumbers.find(n=>n.type==="work")!.id).toBe(old.phoneNumbers[0].id);
  });
  it("never half-assigns a pair when only one free number remains",async()=>{
    await db.query("DELETE FROM available_numbers WHERE id<>'fixture-0'");
    await expect(assignProfiles(db,"alice","both",inspect)).rejects.toMatchObject({code:"pool_unavailable"});
    expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(0);
    expect((await db.query("SELECT * FROM available_numbers WHERE is_assigned")).rowCount).toBe(0);
  });
  it("allows only one owner to claim the same last pool number",async()=>{
    await db.query("DELETE FROM available_numbers WHERE id<>'fixture-0'");
    const r=await Promise.allSettled([assignProfiles(db,"alice","work",inspect),assignProfiles(db,"bob","work",inspect)]);
    expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(1);
  });
  it("rolls back on a write failure and recovers by retry without half a pair",async()=>{
    await db.query(`CREATE FUNCTION fail_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.name='Work' THEN RAISE EXCEPTION 'synthetic fault'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_fault BEFORE INSERT ON phone_numbers FOR EACH ROW EXECUTE FUNCTION fail_fixture();`);
    try{
      await expect(assignProfiles(db,"alice","both",inspect)).rejects.toThrow("synthetic fault");
      expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(0);
      expect((await db.query("SELECT * FROM available_numbers WHERE is_assigned")).rowCount).toBe(0);
    }finally{await db.query("DROP TRIGGER fixture_fault ON phone_numbers; DROP FUNCTION fail_fixture()");}
    expect((await assignProfiles(db,"alice","both",inspect)).phoneNumbers).toHaveLength(2);
  });
  it("recovers a lost reply after a successful commit without allocating again",async()=>{
    let lost=false;
    const unreliable={connect:async()=>{
      const c=await db.connect();return {release:()=>c.release(),query:async(sql:string,args:any[])=>{
        const r=await c.query(sql,args);
        if(sql==="COMMIT"&&!lost){lost=true;throw new Error("lost response after commit");}return r;
      }};
    }} as unknown as Pool;
    await expect(assignProfiles(unreliable,"alice","both",inspect)).rejects.toThrow("lost response");
    expect((await assignProfiles(db,"alice","both",inspect)).reused).toBe(true);
    expect((await db.query("SELECT * FROM phone_numbers")).rowCount).toBe(2);
  });
  it("fails closed on subscription/provider errors and occupied-pool drift",async()=>{
    await expect(assignProfiles(db,"free","work",inspect)).rejects.toMatchObject({code:"subscription_required"});
    await expect(assignProfiles(db,"alice","both",async()=>({...await inspect(),foundOnMain:false}))).rejects.toMatchObject({code:"number_route_not_ready"});
    const b=await assignProfiles(db,"bob","work",inspect);
    await db.query("UPDATE available_numbers SET is_assigned=false WHERE twilio_number=$1",[b.phoneNumbers[0].phoneNumber]);
    const a=await assignProfiles(db,"alice","work",inspect);
    expect(a.phoneNumbers[0].phoneNumber).not.toBe(b.phoneNumbers[0].phoneNumber);
    expect((await db.query("SELECT * FROM phone_numbers WHERE user_id='free'")).rowCount).toBe(0);
  });
});
