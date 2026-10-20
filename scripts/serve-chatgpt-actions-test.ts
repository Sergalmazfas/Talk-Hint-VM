import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createActionsMockServer } from "../server/chatgpt/actionsMockServer";

// This process never boots server/index.ts. Existing secrets are not used.
// Configure only in a separate approved test environment, never on production.
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing test-only setting: ${name}`);
  return value;
};
const preview = process.argv.includes("--local-preview");
const port = Number(process.env.CHATGPT_ACTIONS_TEST_PORT || "8000");
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5000)
  throw new Error("Choose an isolated test port, never the native phone server port");
const { app } = createActionsMockServer(preview ? {
  origin: "https://secretary.test",
  redirectUri: "https://chatgpt.com/aip/g-TalkHintTransportTest/oauth/callback",
  clientSecret: randomBytes(48).toString("base64url"),
  ownerPassword: randomBytes(48).toString("base64url"),
  outbound: false,
} : {
  origin: required("CHATGPT_ACTIONS_TEST_ORIGIN"),
  // Schema bootstrap is allowed before the real GPT exposes its callback.
  // Authorization remains fail-closed until that exact callback is configured.
  redirectUri: process.env.CHATGPT_ACTIONS_TEST_CALLBACK || "",
  clientSecret: required("CHATGPT_ACTIONS_TEST_CLIENT_SECRET"),
  ownerPassword: required("CHATGPT_ACTIONS_TEST_OWNER_PASSWORD"),
  outbound: process.env.CHATGPT_ACTIONS_TEST_OUTBOUND_ENABLED === "true",
});
// Public binding is explicit and intended only for an approved isolated
// test host whose HTTPS ingress terminates TLS. It never enables a dialer.
const host = preview || process.argv.includes("--public-test") ? "0.0.0.0" : "127.0.0.1";
const server = createServer(app).listen(port, host, () => {
  console.log(`TalkHint mock API listening on ${host}:${port}. Synthetic only; real dialer unavailable.`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => { server.close(() => process.exit(0)); });
