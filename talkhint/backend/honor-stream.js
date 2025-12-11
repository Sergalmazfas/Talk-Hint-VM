const { GPTRealtimeHandler } = require('./gpt-handler');

const activeSessions = new Map();

function createHonorStreamHandler(uiBroadcast) {
  return async function honorStreamHandler(ws, request) {
    console.log('[honor-stream] Browser mic connected');
    
    let sessionId = null;
    let gptHandler = null;

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'start':
            sessionId = message.sessionId || Date.now().toString(36);
            console.log(`[honor-stream] Session started: ${sessionId}`);

            gptHandler = new GPTRealtimeHandler({
              onTranscript: (transcript) => {
                ws.send(JSON.stringify({
                  type: 'transcript',
                  sessionId,
                  ...transcript
                }));
                uiBroadcast({
                  type: 'hon_transcript',
                  sessionId,
                  ...transcript
                });
              },
              onResponse: (response) => {
                ws.send(JSON.stringify({
                  type: 'response',
                  sessionId,
                  ...response
                }));
                uiBroadcast({
                  type: 'hon_response',
                  sessionId,
                  ...response
                });
              },
              onAudio: (pcm16Audio) => {
                ws.send(JSON.stringify({
                  type: 'audio',
                  audio: pcm16Audio
                }));
              },
              onError: (error) => {
                ws.send(JSON.stringify({
                  type: 'error',
                  error: error.message || error
                }));
              }
            });

            await gptHandler.connect();
            activeSessions.set(sessionId, { gptHandler, ws });

            ws.send(JSON.stringify({
              type: 'ready',
              sessionId
            }));
            break;

          case 'audio':
            if (gptHandler && message.audio) {
              gptHandler.sendAudio(message.audio);
            }
            break;

          case 'commit':
            if (gptHandler) {
              gptHandler.commitAudio();
            }
            break;

          case 'stop':
            console.log(`[honor-stream] Session ended: ${sessionId}`);
            
            if (gptHandler) {
              gptHandler.disconnect();
            }
            
            if (sessionId) {
              activeSessions.delete(sessionId);
            }

            ws.send(JSON.stringify({
              type: 'stopped',
              sessionId
            }));
            break;

          default:
            console.log(`[honor-stream] Unknown message type: ${message.type}`);
        }
      } catch (err) {
        console.error('[honor-stream] Message error:', err.message);
        ws.send(JSON.stringify({
          type: 'error',
          error: err.message
        }));
      }
    });

    ws.on('close', () => {
      console.log('[honor-stream] Connection closed');
      
      if (gptHandler) {
        gptHandler.disconnect();
      }
      
      if (sessionId) {
        activeSessions.delete(sessionId);
      }
    });

    ws.on('error', (err) => {
      console.error('[honor-stream] WebSocket error:', err.message);
    });
  };
}

function getActiveSessions() {
  return activeSessions;
}

module.exports = {
  createHonorStreamHandler,
  getActiveSessions
};
