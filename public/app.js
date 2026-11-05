const pageName = document.body.dataset.page;
const accent = document.body.dataset.accent;
document.documentElement.style.setProperty('--accent', accent);

document.querySelector('#app').innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div><p class="eyebrow">SHARED CANVAS / ${pageName.toUpperCase()}</p><h1>Leave a <span>thought.</span></h1></div>
      <div id="status" class="badge">Connecting…</div>
    </header>
    <section class="canvas-wrap">
      <canvas id="canvas" width="1000" height="600" aria-label="Shared text canvas"></canvas>
      <form id="note-form" class="toolbar">
        <input id="note-input" maxlength="120" autocomplete="off" placeholder="Type a note, then click where it should land…" />
        <button type="submit">Add to canvas</button>
        <button type="button" class="secondary" id="clear">Clear all</button>
      </form>
    </section>
    <p class="hint">Tip: open Page One and Page Two in separate tabs. Notes appear for every connected client instantly.</p>
  </main>`;

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const input = document.querySelector('#note-input');
const form = document.querySelector('#note-form');
const status = document.querySelector('#status');
let notes = [];
let cursor = { x: canvas.width / 2, y: canvas.height / 2 };

function draw() {
  ctx.fillStyle = '#121720';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#202b3a';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= canvas.height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
  ctx.font = '700 12px system-ui';
  ctx.fillStyle = '#637084';
  ctx.fillText(`${notes.length} ${notes.length === 1 ? 'note' : 'notes'} · shared live`, 24, 28);
  for (const note of notes) {
    ctx.font = '600 16px system-ui';
    const width = Math.min(canvas.width - 48, Math.max(150, ctx.measureText(note.text).width + 34));
    const height = 54;
    ctx.fillStyle = note.color;
    ctx.beginPath(); ctx.roundRect(note.x - width / 2, note.y - height / 2, width, height, 10); ctx.fill();
    ctx.fillStyle = '#211f24';
    ctx.fillText(note.text, note.x - width / 2 + 17, note.y + 6);
  }
}

function socketUrl() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`; }
const socket = new WebSocket(socketUrl());
socket.addEventListener('open', () => { status.textContent = 'Connected live'; status.classList.add('connected'); });
socket.addEventListener('close', () => { status.textContent = 'Disconnected'; status.classList.remove('connected'); });
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'canvas-state') notes = message.notes;
  if (message.type === 'note-added') notes.push(message.note);
  if (message.type === 'canvas-cleared') notes = [];
  draw();
});

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  cursor = { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'add-note', text, x: cursor.x, y: cursor.y, color: accent === '#ff8a65' ? '#ffd0a8' : '#c9c3ff' }));
  input.value = '';
  input.focus();
});
document.querySelector('#clear').addEventListener('click', () => {
  if (socket.readyState === WebSocket.OPEN && confirm('Clear the shared canvas for everyone?')) socket.send(JSON.stringify({ type: 'clear-canvas' }));
});
draw();
