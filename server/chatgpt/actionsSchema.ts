import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";

const API = "/api/chatgpt-actions";
const reads = [
  ["profile", "get_profile", "Read the authenticated TalkHint owner profile."],
  ["calls", "list_calls", "List the owner's recent calls and saved summaries."],
  ["calls/{id}", "get_call", "Read an owned call's status and saved result. Transcript requires a separate scope."],
  ["tasks", "list_tasks", "List the owner's recent Secretary tasks."],
  ["tasks/{id}", "get_task", "Read an owned task's status and saved result using its task_id."],
  ["tasks/{id}/result", "get_call_result", "Read the saved final summary and complete transcript; never starts another call."],
] as const;
const record = { type: "object", properties: {
  id: { type: "string" }, status: { type: "string" }, summary: { type: "string" },
  outcome: { type: "string" }, clientRequestId: { type: "string" },
}, additionalProperties: true };
const response = (description: string, schema: object = { type: "object",
  properties: { error: { type: "string" }, history_url: { type: "string" } }, additionalProperties: true }) =>
  ({ description, content: { "application/json": { schema } } });

/** Portable OpenAPI Actions document, not the public Plugin/MCP ZIP format. */
export function talkHintActionsSchema(origin: string, outbound = false) {
  const url = new URL(origin);
  if (url.origin !== origin || url.port || !origin.startsWith("https://")) throw new Error("HTTPS origin on 443 required");
  const paths: Record<string, unknown> = {};
  const errors = { "400": response("Invalid arguments"), "401": response("Reconnect TalkHint"),
    "403": response("Missing permission or separate owner approval"), "404": response("Owned record not found"),
    "413": response("Result too large for Actions; use the protected TalkHint history"),
    "429": response("Rate limited"), "503": response("Unavailable; do not redial") };
  for (const [path, name, description] of reads) paths[`${API}/${path}`] = { get: {
    operationId: name, description, "x-openai-isConsequential": false,
    security: [{ TalkHintOAuth: ["calls:read"] }],
    parameters: path.includes("{id}") ? [
      { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } },
      { name: "includeTranscript", in: "query", required: false, description: "Only on explicit request; requires calls:transcript.",
        schema: { type: "boolean", default: false } },
    ] : [],
    responses: { "200": response("Owned result", name === "get_profile" ?
      { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false } :
      name === "list_calls" || name === "list_tasks" ? { type: "object", required: [name === "list_calls" ? "calls" : "tasks"],
        properties: { [name === "list_calls" ? "calls" : "tasks"]: { type: "array", items: record } } } : record), ...errors },
  } };
  if (outbound) {
    paths[`${API}/drafts`] = { post: {
      operationId: "prepare_call", description: "Prepare a signed draft only. Open approval_url for independent owner review. Does not queue or dial.",
      "x-openai-isConsequential": true, security: [{ TalkHintOAuth: ["secretary:start"] }],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["phoneNumber", "instruction", "clientRequestId"],
        properties: { phoneNumber: { type: "string", pattern: "^\\+1[2-9]\\d{9}$" },
          instruction: { type: "string", minLength: 1, maxLength: 2000 },
          clientRequestId: { type: "string", format: "uuid" } },
      } } } }, responses: { "200": response("Draft and protected approval_url; no call placed", {
        type: "object", required: ["confirmation", "approval_url", "status"], additionalProperties: true,
        properties: { confirmation: { type: "string" }, approval_url: { type: "string", format: "uri" },
          status: { type: "string", enum: ["owner_approval_required"] } },
      }), ...errors },
    } };
    paths[`${API}/launches`] = { post: {
      operationId: "start_call", description: "Start only the exact separately web-approved draft. Reuse confirmation; return task_id and poll later. Never retry with a new draft after delay.",
      "x-openai-isConsequential": true, security: [{ TalkHintOAuth: ["secretary:start"] }],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["confirmation"],
        properties: { confirmation: { type: "string", maxLength: 16000 } },
      } } } }, responses: { "202": response("Asynchronous task_id; use get_task", {
        type: "object", required: ["task_id", "asynchronous"], additionalProperties: true,
        properties: { task_id: { type: "string" }, asynchronous: { type: "boolean" },
          reused: { type: "boolean" }, task: record },
      }), ...errors },
    } };
  }
  return {
    openapi: "3.1.0", info: { title: "TalkHint Secretary — personal Actions", version: "1.0.0",
      description: "Owner-only TalkHint calls and Secretary. No SMS, incoming AI, forwarding or automatic recording." },
    servers: [{ url: origin }], paths,
    components: { securitySchemes: { TalkHintOAuth: { type: "oauth2", flows: { authorizationCode: {
      authorizationUrl: `${origin}${API}/oauth/authorize`, tokenUrl: `${origin}${API}/oauth/token`,
      scopes: { "calls:read": "Read own history and task results", "calls:transcript": "Read own transcripts on request",
        ...(outbound ? { "secretary:start": "Prepare calls; each launch still requires separate owner web approval" } : {}),
        offline_access: "Maintain the approved connection with rotating refresh tokens" },
    } } } } },
  };
}

type Wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler;
type Execute = (req: Request, name: any, raw: unknown) => Promise<unknown>;
export function registerActionOperations(app: Express, api: string, outbound: boolean, wrap: Wrap, execute: Execute) {
  const send = (res: Response, value: unknown, code = 200) => {
    // Fail explicitly rather than silently truncating a transcript or exceeding Actions' 100k limit.
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 95_000)
      return res.status(413).json({ error: "Result too large for Actions", history_url: `${api}/secretary` });
    return res.status(code).json(value);
  };
  for (const [path, name] of reads) app.get(`${api}/${path.replace("{id}", ":id")}`, wrap(async (req, res) => {
    const query = z.object({ includeTranscript: z.enum(["true", "false"]).optional() }).strict().parse(req.query);
    if (!path.includes("{id}") && query.includeTranscript !== undefined) return res.status(400).json({ error: "Unexpected transcript argument" });
    return send(res, await execute(req, name, path.includes("{id}") ?
      { id: req.params.id, ...(name === "get_call_result" ? {} : { includeTranscript: query.includeTranscript === "true" }) } : {}));
  }));
  if (outbound) {
    app.post(`${api}/drafts`, wrap(async (req, res) => {
      const args = z.object({ phoneNumber: z.string(), instruction: z.string(), clientRequestId: z.string() })
        .strict().parse(req.body);
      return send(res, await execute(req, "prepare_call", args));
    }));
    app.post(`${api}/launches`, wrap(async (req, res) => send(res, await execute(req, "start_call", req.body), 202)));
  }
}
