/*
 * Bix Transform — zero-dependency launcher / static server.
 *
 *   node server.mjs               start, pick a free port, open the browser
 *   node server.mjs --port 8080   force a port
 *   node server.mjs --no-open     don't launch a browser
 *   node server.mjs --host 0.0.0.0  serve to other devices on the network
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/* Serve the app next to this file, no matter where it was launched from —
   double-clicking a launcher rarely leaves you in the project directory. */
const ROOT = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const HOST = value('host', process.env.HOST || '127.0.0.1');
const START_PORT = Number(value('port', process.env.PORT || 5173));
const SHOULD_OPEN = !flag('no-open');
const MAX_PORT_TRIES = 20;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.includes('..')) { res.writeHead(403).end('Forbidden'); return; }
    if (path === '/' || path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

/** Try consecutive ports so a second copy (or another dev server) never blocks the launch. */
function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES) {
      // A failed listen() leaves its one-shot 'listening' callback attached,
      // which would fire (with the stale port) once a later attempt succeeds.
      server.removeAllListeners('listening');
      listen(port + 1, attempt + 1);
    } else {
      console.error(`\n  Could not start the server: ${err.message}\n`);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => ready(port, attempt > 0));
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] = platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      console.log('  (Could not open a browser automatically — copy the address above.)');
    });
    child.unref();
  } catch {
    console.log('  (Could not open a browser automatically — copy the address above.)');
  }
}

function ready(port, moved) {
  const url = `http://localhost:${port}`;
  const lan = HOST === '0.0.0.0' ? lanAddress() : null;
  console.log('');
  console.log('  \x1b[1m\x1b[38;5;209mBix Transform\x1b[0m is running');
  console.log('');
  console.log(`  Local     \x1b[4m${url}\x1b[0m`);
  if (lan) console.log(`  Network   \x1b[4mhttp://${lan}:${port}\x1b[0m`);
  if (moved) console.log(`  (port ${START_PORT} was busy, moved to ${port})`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
  if (SHOULD_OPEN) openBrowser(url);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n  Bix Transform stopped.\n');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

listen(START_PORT);
