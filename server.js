import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = { '/fonts/Orbitron.ttf': ['fonts/Orbitron.ttf', 'font/ttf'], '/recorder-worklet.js': ['recorder-worklet.js', 'text/javascript'], '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/audio.js': ['audio.js', 'text/javascript'] };
http.createServer(async (request, response) => {
  const file = files[new URL(request.url, 'http://localhost').pathname];
  if (!file) { response.writeHead(404); response.end('Nicht gefunden'); return; }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(500); response.end('Datei konnte nicht geladen werden.');
  }
}).listen(3000, '127.0.0.1', () => console.log('Paul Revers läuft auf http://localhost:3000'));
