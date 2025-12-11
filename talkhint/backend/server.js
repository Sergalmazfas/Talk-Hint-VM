const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

const wsHandlers = {};

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (wsHandlers[pathname]) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wsHandlers[pathname](ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] TalkHint running on port ${PORT}`);
});

module.exports = {
  app,
  server,
  wss,
  registerWebSocket: (path, handler) => {
    wsHandlers[path] = handler;
    console.log(`[server] WebSocket handler registered: ${path}`);
  }
};
