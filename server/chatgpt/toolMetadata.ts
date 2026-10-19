import type { Scope } from "./security";

export const PUBLIC_TOOLS = ["get_profile", "list_calls", "get_call", "list_tasks", "get_task",
  "prepare_call", "start_call"] as const;
export type PublicTool = typeof PUBLIC_TOOLS[number];
const descriptions: Record<PublicTool, [string, string]> = {
  get_profile: ["Connected TalkHint profile", "Return the stable profile ID represented by the authenticated credentials. No account selector."],
  list_calls: ["Your recent calls", "List up to 50 calls from the connected TalkHint account, their saved statuses and available Secretary summaries. No audio or transcript."],
  get_call: ["Saved call details", "Read one call from the connected account. Include transcript only when explicitly requested and separately authorized."],
  list_tasks: ["Your Secretary tasks", "List up to 50 saved Secretary tasks, statuses and summaries from the connected account. Does not create or retry work."],
  get_task: ["Saved Secretary result", "Read a task by its returned task_id, including saved status, summary, facts and next step. Request again for an asynchronous result; never redial because it is delayed. Transcript requires separate permission."],
  prepare_call: ["Prepare a call for owner review", "Prepare a signed preview with the exact +1 number, brief task and stable clientRequestId, only on the user's explicit request. Returns approval_url. No job is enqueued and no number is dialed. The owner must review and approve in TalkHint."],
  start_call: ["Start the owner-approved call", "Start one existing Secretary task only after separate server-verified owner approval of its exact number and task. Returns task_id immediately. Reuse the approved request; never create a new request to retry an ambiguous result."],
};

export function publicToolMetadata(name: PublicTool, scope: Scope, properties: object, required: string[]) {
  const write = name === "start_call";
  const preview = name === "prepare_call";
  const securitySchemes = [{ type: "oauth2", scopes: [scope] }];
  return {
    name, title: descriptions[name][0], description: descriptions[name][1],
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    annotations: {
      readOnlyHint: !write, destructiveHint: write, openWorldHint: write || preview,
      idempotentHint: !preview,
    },
    securitySchemes,
    _meta: { securitySchemes, ...(name === "get_profile" ? { "openai/profile": true } : {}) },
    ...(name === "get_profile" ? { outputSchema: {
      type: "object", properties: { id: { type: "string", minLength: 1, pattern: "\\S",
        description: "Persisted profile identity, unchanged across refresh and reconnection." } },
      required: ["id"], additionalProperties: false,
    } } : {}),
  };
}
