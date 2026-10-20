import assert from "node:assert/strict";
import { createServer, request } from "node:https";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActionsMockServer, MOCK_CLIENT, MOCK_EMAIL, MOCK_OWNER, MOCK_PHONE } from "../server/chatgpt/actionsMockServer";

const origin = "https://secretary.test";
const api = "/api/chatgpt-actions";
const redirectUri = "https://chatgpt.com/aip/g-TalkHintTransportTest/oauth/callback";
const checks: string[] = [];
const check = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const temp = await mkdtemp(join(tmpdir(), "talkhint-actions-tls-"));
const originalFetch = globalThis.fetch;
// A protocol probe must never reach a model/provider/real backend.
globalThis.fetch = async () => { throw new Error("External fetch forbidden in the isolated TLS probe"); };
const clientSecret = randomBytes(48).toString("base64url");
const password = randomBytes(48).toString("base64url");
let server: ReturnType<typeof createServer> | undefined;
try {
  const unconfigured = spawnSync(process.execPath, ["--import", "tsx", "scripts/serve-chatgpt-actions-test.ts"],
    { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 10_000 });
  assert.equal(unconfigured.status, 1);
  assert.equal(unconfigured.stdout, "");
  assert.match(unconfigured.stderr, /Missing test-only setting: CHATGPT_ACTIONS_TEST_ORIGIN/);
  check("Unconfigured test process fails closed without inheriting native credentials or booting native services");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=secretary.test", "-addext", "subjectAltName=DNS:secretary.test",
    "-keyout", join(temp, "key.pem"), "-out", join(temp, "cert.pem")], { stdio: "ignore" });
  const ca = await readFile(join(temp, "cert.pem"));
  const fixture = createActionsMockServer({ origin, redirectUri, clientSecret, ownerPassword: password, outbound: true });
  server = createServer({ key: await readFile(join(temp, "key.pem")), cert: ca,
    minVersion: "TLSv1.2" }, fixture.app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  type Result = { status: number; headers: import("node:http").IncomingHttpHeaders; text: string; json: any };
  const send = (path: string, options: { method?: string; headers?: Record<string, string>;
    form?: object; json?: object; trust?: boolean } = {}): Promise<Result> => new Promise((resolve, reject) => {
    const body = options.form ? new URLSearchParams(options.form as Record<string, string>).toString() :
      options.json ? JSON.stringify(options.json) : "";
    // Local socket override only. TLS SNI and hostname verification remain enabled.
    const req = request({ hostname: "127.0.0.1", port, servername: "secretary.test",
      ca: options.trust === false ? undefined : ca, rejectUnauthorized: true, path,
      method: options.method || "GET", headers: { Host: "secretary.test",
        ...(body ? { "Content-Type": options.form ? "application/x-www-form-urlencoded" : "application/json",
          "Content-Length": String(Buffer.byteLength(body)) } : {}), ...options.headers } }, res => {
      let text = "";
      res.setEncoding("utf8").on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json; try { json = JSON.parse(text); } catch { /* HTML page. */ }
        resolve({ status: res.statusCode!, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
  await assert.rejects(send("/test/health", { trust: false }));
  assert.equal((await send("/test/health")).json.realDialerAvailable, false);
  check("HTTPS certificate and hostname checked; untrusted certificate rejected");
  const spec = await send(`${api}/openapi.json`);
  assert.equal(spec.json.openapi, "3.1.0");
  assert.equal(Object.keys(spec.json.paths).length, 7);
  assert.equal(JSON.stringify(spec.json).includes(clientSecret), false);
  assert.equal(JSON.stringify(spec.json).includes(password), false);
  assert.equal((await send(`${api}/calls`)).status, 401);
  assert.equal((await send("/start-call", { method: "POST", json: {} })).status, 404);
  check("Schema contains no credentials; unauthenticated reads and legacy dialing unavailable");

  const cookies = new Map<string, string>();
  const web = async (path: string, form?: object, extraHeaders = {}) => {
    const u = new URL(path, origin);
    assert.equal(u.origin, origin); // Never follow the ChatGPT callback or any external redirect.
    const result = await send(u.pathname + u.search, { method: form ? "POST" : "GET", form,
      headers: { Accept: "text/html", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(form ? { Origin: origin } : {}), ...extraHeaders } });
    for (const value of result.headers["set-cookie"] ?? []) {
      assert.match(value, /;\s*Secure/i); assert.match(value, /;\s*HttpOnly/i);
      assert.match(value, /;\s*SameSite=Lax/i);
      const pair = value.split(";")[0], at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return result;
  };
  const fields = (result: Result) => {
    const value = (name: string) => {
      const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(result.text);
      assert.ok(match, `Missing ${name}`); return match[1];
    };
    return { flow: value("flow"), csrf: value("csrf") };
  };
  const authorize = async (scope: string) => {
    const state = randomUUID();
    const initial = await web(`${api}/oauth/authorize?${new URLSearchParams({
      response_type: "code", client_id: MOCK_CLIENT, redirect_uri: redirectUri, scope, state,
    })}`);
    assert.equal(initial.status, 303);
    let review = await web(initial.headers.location!);
    if (review.text.includes('name="password"')) {
      assert.match(review.text, /ТЕСТ: только вымышленные данные/);
      const invalid = await web(`${api}/browser/login`,
        { ...fields(review), email: "not-owner@example.test", password });
      assert.equal(invalid.status, 401);
      const signed = await web(`${api}/browser/login`, { ...fields(invalid), email: MOCK_EMAIL, password });
      assert.equal(signed.status, 303);
      review = await web(signed.headers.location!);
    }
    const bad = await web(`${api}/browser/consent`, { ...fields(review), csrf: "forged", decision: "allow" });
    assert.equal(bad.status, 403);
    const consent = await web(`${api}/browser/consent`, { ...fields(review), decision: "allow" });
    assert.equal(consent.status, 303);
    const callback = new URL(consent.headers.location!);
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), state);
    const code = callback.searchParams.get("code")!;
    const tokenBody = { grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: MOCK_CLIENT, client_secret: clientSecret };
    assert.equal((await send(`${api}/oauth/token`, { method: "POST",
      form: { ...tokenBody, client_secret: "invalid" } })).status, 401);
    const token = await send(`${api}/oauth/token`, { method: "POST", form: tokenBody });
    assert.equal(token.status, 200);
    assert.equal((await send(`${api}/oauth/token`, { method: "POST", form: tokenBody })).status, 400);
    return token.json as { access_token: string; refresh_token: string };
  };
  const read = await authorize("calls:read offline_access");
  const auth = (access: string) => ({ Authorization: `Bearer ${access}` });
  assert.equal((await send(`${api}/profile`, { headers: auth(read.access_token) })).json.id, MOCK_OWNER);
  assert.equal((await send(`${api}/calls`, { headers: auth(read.access_token) })).json.calls[0].mock, true);
  assert.equal((await send(`${api}/calls/foreign-call`, { headers: auth(read.access_token) })).status, 404);
  assert.equal((await send(`${api}/calls/synthetic-call?includeTranscript=true`,
    { headers: auth(read.access_token) })).status, 403);
  assert.equal((await send(`${api}/tasks`, { headers: auth(read.access_token) })).json.tasks.length, 0);
  check("Owner test login, state, CSRF, single-use code, client secret and read-only scope enforced over HTTPS");

  const input = { phoneNumber: MOCK_PHONE, instruction: "TEST ONLY: ask fictional opening hours.", clientRequestId: randomUUID() };
  assert.equal((await send(`${api}/drafts`, { method: "POST", headers: auth(read.access_token), json: input })).status, 403);
  const write = await authorize("calls:read secretary:start offline_access");
  const prepared = await send(`${api}/drafts`, { method: "POST", headers: auth(write.access_token), json: input });
  assert.equal(prepared.status, 200);
  assert.equal(fixture.stats().dispatches, 0);
  const launch = () => send(`${api}/launches`, { method: "POST", headers: auth(write.access_token),
    json: { confirmation: prepared.json.confirmation } });
  assert.equal((await launch()).status, 403);
  assert.equal((await send(`${api}/launches`, { method: "POST", headers: auth(write.access_token),
    json: { confirmation: prepared.json.confirmation, confirmed: true } })).status, 400);
  assert.equal((await send(`${api}/drafts`, { method: "POST", headers: auth(write.access_token),
    json: { ...input, phoneNumber: "+12125552345" } })).status, 400);
  check("Read-only cannot draft; no queue/dial before approval; confirmed:true and non-fictional numbers rejected");
  const approval = await web(prepared.json.approval_url);
  const review = await web(approval.headers.location!);
  assert.match(review.text, new RegExp(MOCK_PHONE.replace("+", "\\+")));
  assert.ok(review.text.includes(input.instruction));
  assert.equal((await web(`${api}/browser/approve`, { ...fields(review), decision: "approve" },
    { Origin: "https://attacker.test" })).status, 403);
  assert.equal((await web(`${api}/browser/approve`, { ...fields(review), decision: "approve" })).status, 200);
  assert.equal(fixture.stats().dispatches, 0);
  const [one, two] = await Promise.all([launch(), launch()]);
  assert.equal(one.status, 202); assert.equal(two.status, 202);
  assert.equal(one.json.asynchronous, true);
  assert.equal(one.json.task_id, two.json.task_id);
  assert.deepEqual(fixture.stats(), { dispatches: 1, tasks: 1 });
  const task = await send(`${api}/tasks/${one.json.task_id}`, { headers: auth(write.access_token) });
  assert.equal(task.json.mock, true); assert.equal(task.json.status, "completed");
  assert.equal(task.json.mockDispatches, 1);
  check("Separate exact owner approval; parallel launches produce one mock dispatch and one task_id; result readable");
  const revoke = await send(`${api}/oauth/revoke`, { method: "POST", form: {
    client_id: MOCK_CLIENT, client_secret: clientSecret, token: write.refresh_token,
  } });
  assert.equal(revoke.status, 200);
  assert.equal((await send(`${api}/tasks`, { headers: auth(write.access_token) })).status, 401);
  assert.equal((await launch()).status, 401);
  assert.equal((await send(`${api}/calls`, { headers: auth(read.access_token) })).status, 200);
  check("Grant revocation rejects reads and launch; independent read grant remains usable");
  const report = { checkedAt: new Date().toISOString(), transport: "real TLS on loopback with test CA and SNI",
    client: "automated HTTPS probe, NOT ChatGPT or iPhone", data: "synthetic-only",
    externalEndpointConfigured: false, actualTalkHintOwnerVerified: false,
    externalCalls: 0, task_id: one.json.task_id,
    result: { mock: true, status: task.json.status },
    taskLifetime: "ephemeral fixture; not queryable after this probe exits",
    ...fixture.stats(), checks };
  await mkdir("generated-artifacts/talkhint-actions/https-test", { recursive: true });
  await writeFile("generated-artifacts/talkhint-actions/https-test/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log("REPORT generated-artifacts/talkhint-actions/https-test/report.json");
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  globalThis.fetch = originalFetch;
  await rm(temp, { recursive: true, force: true });
}
