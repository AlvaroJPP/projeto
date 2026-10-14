const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const webRoot = path.resolve(__dirname, '../web');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'microdroid-single-port', port }));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(webRoot, `.${pathname}`);
  if (filePath !== webRoot && !filePath.startsWith(webRoot + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const headers = {
      'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

// HTTP e WebSocket compartilham a mesma porta para que o OpenTunnel precise expor apenas 8080.
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function leave(ws) {
  if (!ws.room) return;
  const roomName = ws.room;
  const room = rooms.get(roomName);
  if (room) {
    room.delete(ws);
    for (const peer of room) send(peer, { type: 'peer-left', room: roomName });
    if (!room.size) rooms.delete(roomName);
  }
  ws.room = null;
  ws.role = null;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: 'JSON inválido' });
    }

    if (msg.type === 'join') {
      const roomName = String(msg.room || '').trim().slice(0, 80);
      if (!/^[a-zA-Z0-9_-]{3,80}$/.test(roomName)) {
        return send(ws, { type: 'error', message: 'Sala inválida (3-80 letras, números, _ ou -)' });
      }
      leave(ws);
      const room = rooms.get(roomName) || new Set();
      if (room.size >= 2) return send(ws, { type: 'error', message: 'Sala cheia' });
      for (const peer of room) send(peer, { type: 'peer-joined', room: roomName });
      room.add(ws);
      rooms.set(roomName, room);
      ws.room = roomName;
      ws.role = msg.role === 'broadcaster' ? 'broadcaster' : 'viewer';
      send(ws, { type: 'joined', room: roomName, peers: room.size - 1 });
      if (room.size === 2) {
        // Notifica o broadcaster recém-chegado para iniciar a oferta WebRTC.
        if (ws.role === 'broadcaster') send(ws, { type: 'peer-joined', room: roomName });
      }
      return;
    }

    if (!ws.room) return send(ws, { type: 'error', message: 'Entre em uma sala antes de sinalizar' });
    if (!['offer', 'answer', 'candidate', 'hangup'].includes(msg.type)) return;
    const room = rooms.get(ws.room);
    if (!room) return;
    for (const peer of room) {
      if (peer !== ws) send(peer, { ...msg, room: ws.room });
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.on('close', () => clearInterval(heartbeat));
server.listen(port, host, () => {
  console.log(`[MicroDroid] web + WebSocket em http://${host}:${port}`);
  console.log(`[MicroDroid] health: http://localhost:${port}/health`);
});
