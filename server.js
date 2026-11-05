const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const siteDir = __dirname;
const notes = [];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((request, response) => {
  let requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  // Keep the canvas pages in public/, while making the project-root links work too.
  if (requestedPath === '/page-one.html' || requestedPath === '/page-two.html') {
    requestedPath = `/public${requestedPath}`;
  }
  const filePath = path.normalize(path.join(siteDir, requestedPath));

  if (!filePath.startsWith(siteDir)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Not found');
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  });
});

const clients = new Set();

function encodeWebSocketMessage(message) {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketMessage(buffer) {
  if (buffer.length < 2) return null;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) { if (buffer.length < 4) return null; length = buffer.readUInt16BE(2); offset = 4; }
  if (length === 127) { if (buffer.length < 10) return null; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  if (!masked || buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  const payload = buffer.subarray(offset + 4, offset + 4 + length);
  const decoded = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) decoded[index] = payload[index] ^ mask[index % 4];
  return decoded.toString('utf8');
}

function broadcast(message) {
  const encodedMessage = JSON.stringify(message);
  const frame = encodeWebSocketMessage(message);
  for (const client of clients) {
    client.write(frame);
  }
}

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  clients.add(socket);
  socket.write(encodeWebSocketMessage({ type: 'canvas-state', notes }));

  let pendingData = Buffer.alloc(0);
  socket.on('data', (rawMessage) => {
    pendingData = Buffer.concat([pendingData, rawMessage]);
    while (pendingData.length >= 2) {
      const frameLengthCode = pendingData[1] & 0x7f;
      const headerLength = frameLengthCode === 126 ? 4 : frameLengthCode === 127 ? 10 : 2;
      if (pendingData.length < headerLength) break;
      const payloadLength = frameLengthCode === 126
        ? pendingData.readUInt16BE(2)
        : frameLengthCode === 127
          ? Number(pendingData.readBigUInt64BE(2))
          : frameLengthCode;
      const fullFrameLength = headerLength + 4 + payloadLength;
      if (pendingData.length < fullFrameLength) break;
      const frame = pendingData.subarray(0, fullFrameLength);
      pendingData = pendingData.subarray(fullFrameLength);
      try {
        const decoded = decodeWebSocketMessage(frame);
        if (!decoded) continue;
        const message = JSON.parse(decoded);
        if (message.type === 'add-note' && typeof message.text === 'string') {
          const text = message.text.trim().slice(0, 120);
          const x = Number(message.x);
          const y = Number(message.y);
          if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue;

          const note = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
            x: Math.max(20, Math.min(980, x)),
            y: Math.max(20, Math.min(560, y)),
            color: typeof message.color === 'string' ? message.color : '#ffe58a'
          };
          notes.push(note);
          broadcast({ type: 'note-added', note });
        }

        if (message.type === 'clear-canvas') {
          notes.length = 0;
          broadcast({ type: 'canvas-cleared' });
        }
      } catch {
        // Ignore malformed messages from clients.
      }
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`Shared canvas running on ${HOST}:${PORT}`);
});
