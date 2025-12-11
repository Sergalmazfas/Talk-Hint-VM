const { convertMulawToPCM16, convertPCM16ToMulaw } = require('./audio-convert');
const { GPTRealtimeHandler } = require('./gpt-handler');

const activeSessions = new Map();

function createTwilioStreamHandler(uiBroadcast, getCurrentMode) {
  return async function twilioStreamHandler(ws, request) {
    console.log('[twilio-stream] New connection');
    
    let streamSid = null;
    let callSid = null;
    let gptHandler = null;

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'connected':
            console.log('[twilio-stream] Connected event received');
            break;

          case 'start':
            streamSid = message.start.streamSid;
            callSid = message.start.callSid;
            
            console.log(`[twilio-stream] Call started: ${callSid}`);
            console.log(`[twilio-stream] Stream SID: ${streamSid}`);
            
            const mode = getCurrentMode ? getCurrentMode() : 'universal';
            
            gptHandler = new GPTRealtimeHandler({
              mode: mode,
              onTranscript: (transcript) => {
                uiBroadcast({
                  type: 'transcript',
                  callSid,
                  ...transcript
                });
              },
              onResponse: (response) => {
                uiBroadcast({
                  type: 'response',
                  callSid,
                  ...response
                });
              },
              onAudio: async (pcm16Audio) => {
                try {
                  const mulawAudio = await convertPCM16ToMulaw(pcm16Audio);
                  
                  ws.send(JSON.stringify({
                    event: 'media',
                    streamSid: streamSid,
                    media: {
                      payload: mulawAudio
                    }
                  }));
                } catch (err) {
                  console.error('[twilio-stream] Audio conversion error:', err.message);
                }
              },
              onError: (error) => {
                uiBroadcast({
                  type: 'error',
                  callSid,
                  error: error.message || error
                });
              }
            });

            await gptHandler.connect();
            activeSessions.set(callSid, { gptHandler, streamSid });

            uiBroadcast({
              type: 'call_started',
              callSid,
              streamSid
            });
            break;

          case 'media':
            if (gptHandler && message.media && message.media.payload) {
              try {
                const pcm16Audio = await convertMulawToPCM16(message.media.payload);
                gptHandler.sendAudio(pcm16Audio);
              } catch (err) {
                console.error('[twilio-stream] Conversion error:', err.message);
              }
            }
            break;

          case 'stop':
            console.log(`[twilio-stream] Call ended: ${callSid}`);
            
            if (gptHandler) {
              gptHandler.disconnect();
            }
            
            if (callSid) {
              activeSessions.delete(callSid);
            }

            uiBroadcast({
              type: 'call_ended',
              callSid
            });
            break;

          default:
            console.log(`[twilio-stream] Unknown event: ${message.event}`);
        }
      } catch (err) {
        console.error('[twilio-stream] Message parse error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[twilio-stream] Connection closed');
      
      if (gptHandler) {
        gptHandler.disconnect();
      }
      
      if (callSid) {
        activeSessions.delete(callSid);
        uiBroadcast({
          type: 'call_ended',
          callSid
        });
      }
    });

    ws.on('error', (err) => {
      console.error('[twilio-stream] WebSocket error:', err.message);
    });
  };
}

function getActiveSessions() {
  return activeSessions;
}

module.exports = {
  createTwilioStreamHandler,
  getActiveSessions
};
