const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { createTwilioStreamHandler } = require('./twilio-stream');
const { createHonorStreamHandler } = require('./honor-stream');

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

const wsHandlers = {};
const uiClients = new Set();

function uiBroadcast(message) {
  const data = JSON.stringify(message);
  uiClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function uiHandler(ws, request) {
  console.log('[server] UI client connected');
  uiClients.add(ws);

  ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));

  ws.on('close', () => {
    console.log('[server] UI client disconnected');
    uiClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[server] UI WebSocket error:', err.message);
    uiClients.delete(ws);
  });
}

wsHandlers['/twilio-stream'] = createTwilioStreamHandler(uiBroadcast);
wsHandlers['/honor-stream'] = createHonorStreamHandler(uiBroadcast);
wsHandlers['/ui'] = uiHandler;

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (wsHandlers[pathname]) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wsHandlers[pathname](ws, request);
    });
  } else {
    console.log(`[server] Unknown WebSocket path: ${pathname}`);
    socket.destroy();
  }
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uiClients: uiClients.size,
    timestamp: new Date().toISOString()
  });
});

const sseClients = new Set();

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

function sseBroadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  sseClients.forEach((client) => {
    client.write(data);
  });
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] TalkHint running on port ${PORT}`);
  console.log(`[server] WebSocket endpoints:`);
  console.log(`         - /twilio-stream (Twilio Media Streams)`);
  console.log(`         - /honor-stream (Browser Microphone)`);
  console.log(`         - /ui (Browser UI)`);
  console.log(`[server] SSE endpoint: /events`);
});

module.exports = {
  app,
  server,
  wss,
  uiBroadcast,
  sseBroadcast,
  registerWebSocket: (path, handler) => {
    wsHandlers[path] = handler;
    console.log(`[server] WebSocket handler registered: ${path}`);
  }
};
