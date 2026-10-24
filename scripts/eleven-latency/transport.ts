import { WebSocketConnection } from "../../node_modules/@elevenlabs/client/dist/utils/WebSocketConnection.js";

/** The agent has first_message="". Metadata establishes the connection; no
 * greeting/Custom LLM callback is required before the caller sends a scenario. */
export async function connectProbeSocket(
  signedUrl: string,
  onAudio: (event: any) => void,
  onMessage: (event: any) => void,
) {
  const sdk = await WebSocketConnection.create({ signedUrl });
  sdk.addListener(onAudio);
  sdk.onMessage((event: any) => {
    if (event.type === "ping") sdk.sendMessage({ type: "pong", event_id: event.ping_event.event_id });
    onMessage(event);
  });
  return sdk;
}
