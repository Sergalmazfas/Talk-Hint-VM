import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";
import { storage } from "./storage";

interface TwilioMediaMessage {
  event: string;
  sequenceNumber?: string;
  streamSid?: string;
  media?: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
  start?: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
  };
  stop?: {
    accountSid: string;
    callSid: string;
  };
}

interface SessionData {
  callSid: string;
  streamSid: string;
  transcript: string[];
  openaiWs?: WebSocket;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    
    if (pathname === "/twilio-stream") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    log("New Twilio WebSocket connection", "twilio");
    
    const sessionData: SessionData = {
      callSid: "",
      streamSid: "",
      transcript: [],
    };

    ws.on("message", async (data: Buffer) => {
      try {
        const message: TwilioMediaMessage = JSON.parse(data.toString());
        
        switch (message.event) {
          case "start":
            if (message.start) {
              sessionData.callSid = message.start.callSid;
              sessionData.streamSid = message.start.streamSid;
              
              log(`Call started: ${sessionData.callSid}`, "twilio");
              
              await storage.createCall({
                callSid: sessionData.callSid,
                fromNumber: message.start.customParameters?.From || "unknown",
                toNumber: message.start.customParameters?.To || "unknown",
                status: "active",
                endedAt: null,
                transcript: null,
                metadata: null,
              });

              initializeOpenAI(ws, sessionData);
            }
            break;

          case "media":
            if (message.media && sessionData.openaiWs) {
              const audioData = message.media.payload;
              
              sessionData.openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: audioData,
              }));
            }
            break;

          case "stop":
            log(`Call ended: ${sessionData.callSid}`, "twilio");
            
            if (sessionData.openaiWs) {
              sessionData.openaiWs.close();
            }

            const call = await storage.getCallByCallSid(sessionData.callSid);
            if (call) {
              await storage.updateCall(call.id, {
                status: "completed",
                endedAt: new Date(),
                transcript: sessionData.transcript.join("\n"),
              });
            }
            
            ws.close();
            break;
        }
      } catch (error) {
        log(`Error processing message: ${error}`, "twilio");
      }
    });

    ws.on("close", () => {
      log("Twilio WebSocket closed", "twilio");
      if (sessionData.openaiWs) {
        sessionData.openaiWs.close();
      }
    });

    ws.on("error", (error) => {
      log(`Twilio WebSocket error: ${error}`, "twilio");
    });
  });

  function initializeOpenAI(twilioWs: WebSocket, session: SessionData) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      log("OpenAI API key not found", "openai");
      return;
    }

    const openaiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    session.openaiWs = openaiWs;

    openaiWs.on("open", () => {
      log("Connected to OpenAI Realtime API", "openai");
      
      openaiWs.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: "You are a helpful AI assistant in a phone call. Be conversational, friendly, and concise. Respond naturally to the caller's questions.",
          voice: "alloy",
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          input_audio_transcription: {
            model: "whisper-1",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      }));
    });

    openaiWs.on("message", (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        
        switch (response.type) {
          case "response.audio.delta":
            if (response.delta) {
              twilioWs.send(JSON.stringify({
                event: "media",
                streamSid: session.streamSid,
                media: {
                  payload: response.delta,
                },
              }));
            }
            break;

          case "conversation.item.input_audio_transcription.completed":
            if (response.transcript) {
              session.transcript.push(`User: ${response.transcript}`);
              log(`User: ${response.transcript}`, "transcript");
            }
            break;

          case "response.text.delta":
            if (response.delta) {
              session.transcript.push(`Assistant: ${response.delta}`);
              log(`Assistant: ${response.delta}`, "transcript");
            }
            break;

          case "error":
            log(`OpenAI error: ${JSON.stringify(response.error)}`, "openai");
            break;
        }
      } catch (error) {
        log(`Error processing OpenAI message: ${error}`, "openai");
      }
    });

    openaiWs.on("close", () => {
      log("OpenAI WebSocket closed", "openai");
    });

    openaiWs.on("error", (error) => {
      log(`OpenAI WebSocket error: ${error}`, "openai");
    });
  }

  return wss;
}
