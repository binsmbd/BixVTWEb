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
import { existsSync } from 'node:fs';
import { extname, dirname, resolve, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/* Serve the app next to this file, no matter where it was launched from —
   double-clicking a launcher rarely leaves you in the project directory. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const HOST = value('host', process.env.HOST || '127.0.0.1');
const START_PORT = Number(value('port', process.env.PORT || 5173));
const SHOULD_OPEN = !flag('no-open');
const VERBOSE = flag('verbose');
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

const escapeHtml = (v) => String(v).replace(/[<>&"']/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

/** A 404 that explains itself — a blank "404 Not Found" tells nobody anything. */
function notFoundPage(path) {
  const rootLooksWrong = !existsSync(resolve(ROOT, 'index.html'));
  const reason = rootLooksWrong
    ? `<p class="warn"><b>The app files are not where this server is looking.</b><br>
         It is serving <code>${ROOT}</code>, and there is no <code>index.html</code> there.
         Run the launcher (<code>start.command</code>, <code>start.bat</code> or
         <code>start.sh</code>) from inside the Bix&nbsp;Transform folder — the one that
         contains <code>index.html</code>, <code>css/</code> and <code>js/</code>.</p>`
    : `<p>The app itself is fine — this address just doesn't match a file.
         <a href="/">Go to Bix Transform</a>.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>404 · Bix Transform</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0f;color:#e6e9ef;
       font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Thai",sans-serif}
  main{max-width:560px;padding:32px 36px;border:1px solid #23262f;border-radius:3px;background:#14161d}
  h1{margin:0 0 4px;font-size:17px}
  .sub{color:#6b7382;margin:0 0 18px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;
       background:#0f1117;border:1px solid #23262f;border-radius:3px;padding:1px 5px}
  a{color:#ee6c4d}
  .warn{border-left:2px solid #ee6c4d;padding-left:12px}
</style>
<main>
  <h1>404 — not found</h1>
  <p class="sub"><code>${escapeHtml(path)}</code></p>
  ${reason}
</main>`;
}

const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

/**
 * Map a URL path onto a file inside ROOT.
 *
 * URL paths are always POSIX-shaped, so they must be normalised with
 * `posix.normalize` — the platform-aware `normalize()` rewrites "/" to "\" on
 * Windows, which used to stop the directory-index rule from ever matching and
 * made every page 404 there. The filesystem join happens afterwards, and the
 * result is checked to be inside ROOT so "..", encoded or not, cannot escape.
 */
export function resolveRequest(pathname, root = ROOT) {
  let p = posix.normalize(safeDecode(pathname));
  if (!p.startsWith('/')) p = '/' + p;                 // posix.normalize("/../x") === "/x"
  if (p.endsWith('/')) p += 'index.html';
  // Browsers ask for this unprompted; hand them the SVG mark instead of a 404.
  if (p === '/favicon.ico') p = '/assets/favicon.svg';
  const file = resolve(root, '.' + p);
  const inside = file === root || file.startsWith(root + sep);
  return { file, inside, urlPath: p };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const log = (status) => {
    if (status === 200 && !VERBOSE) return;
    const tint = status === 200 ? '\x1b[2m' : '\x1b[33m';
    console.log(`  ${tint}${status}  ${req.method} ${safeDecode(url.pathname)}\x1b[0m`);
  };
  try {
    const { file, inside } = resolveRequest(url.pathname);
    if (!inside) { log(403); res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
    log(200);
  } catch {
    log(404);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(notFoundPage(safeDecode(url.pathname)));
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
  console.log(`  Folder    ${ROOT}`);
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

if (!existsSync(resolve(ROOT, 'index.html'))) {
  console.error('');
  console.error('  \x1b[33mWarning:\x1b[0m no index.html next to server.mjs.');
  console.error(`  Serving: ${ROOT}`);
  console.error('  Keep server.mjs in the Bix Transform folder, alongside index.html,');
  console.error('  css/ and js/ — otherwise every page will come back 404.');
  console.error('');
}

listen(START_PORT);
