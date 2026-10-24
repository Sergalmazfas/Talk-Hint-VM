import { parseSecretaryEndRequest, type SecretaryEndRequest } from "./callEnding";

/** Same documented native Live response.event/tool-output exchange as intake.
 * No tool can dial, access another task or directly hang up a provider call. */
export class SecretaryLiveEndTool {
  private seen = new Set<string>();
  private states = new Map<string, { calls: number; done: boolean; continued: boolean }>();
  private lastResponse = "";
  constructor(private send: (event: object) => void,
    private request: (value: SecretaryEndRequest) => void) {}
  event(event: any) {
    if (event?.type === "response.created" && typeof event.response?.id === "string") {
      if (this.states.size >= 64) return;
      this.lastResponse = event.response.id;
      this.states.set(this.lastResponse, { calls: 0, done: false, continued: false });
    }
    const id = event?.response_id ?? event?.response?.id ?? this.lastResponse;
    const state = this.states.get(id);
    if (!state) return;
    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      const item = event.item;
      if (typeof item.call_id !== "string" || item.call_id.length > 200 || this.seen.has(item.call_id)) return;
      if (this.seen.size >= 128) throw new Error("Secretary end-tool safety limit");
      this.seen.add(item.call_id);
      let value;
      if (item.name === "prepare_call_end" && typeof item.arguments === "string" && item.arguments.length <= 2000) {
        try { value = parseSecretaryEndRequest(JSON.parse(item.arguments)); } catch { /* reject invalid JSON */ }
      }
      if (value) this.request(value);
      this.send({ type: "response.item.create", item: {
        type: "function_call_output", call_id: item.call_id,
        output: JSON.stringify(value
          ? { prepared: true, instruction: "Say exactly the supplied farewell now, then listen. Do not claim the call has ended." }
          : { prepared: false, error: "Unsupported or invalid end request; continue the conversation safely." }),
      } });
      state.calls++;
    }
    if (event.type === "response.completed") state.done = true;
    if (state.done && state.calls && !state.continued) {
      state.continued = true;
      this.send({ type: "response.create" });
      this.states.delete(id);
    } else if (state.done && !state.calls) this.states.delete(id);
  }
}
