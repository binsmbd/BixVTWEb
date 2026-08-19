/*
 * URL → file mapping, checked under both POSIX and Windows path semantics.
 *
 * Regression guard: the platform-aware path.normalize() rewrites "/" to "\" on
 * Windows, which stopped the directory-index rule from matching and made every
 * page 404 there. The mapping must stay POSIX-shaped until the filesystem join.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'server.mjs'), 'utf8');

/** Load resolveRequest() out of server.mjs without starting a server. */
function loadResolver(impl, root) {
  const start = source.indexOf('export function resolveRequest');
  const end = source.indexOf('const server = createServer');
  assert.ok(start > 0 && end > start, 'resolveRequest() not found in server.mjs');
  const body = source.slice(start, end).replace('export function', 'function');
  const make = new Function('posix', 'resolve', 'sep', 'safeDecode', 'ROOT',
    `${body}; return resolveRequest;`);
  const decode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
  const fn = make(posix, impl.resolve, impl.sep, decode, root);
  return (pathname) => fn(pathname, root);
}

const CASES = [
  ['/', ['index.html']],
  ['/index.html', ['index.html']],
  ['/css/app.css', ['css', 'app.css']],
  ['/js/transforms/index.js', ['js', 'transforms', 'index.js']],
  ['/favicon.ico', ['assets', 'favicon.svg']],
  ['/js/', ['js', 'index.html']],
];

for (const [impl, root, name] of [[posix, '/srv/bix', 'posix'], [win32, 'E:\\bix', 'windows']]) {
  test(`resolves request paths (${name})`, () => {
    const resolveRequest = loadResolver(impl, root);
    for (const [url, parts] of CASES) {
      const { file, inside } = resolveRequest(url);
      assert.equal(file, [root, ...parts].join(impl.sep), `${url} under ${name}`);
      assert.equal(inside, true, `${url} should resolve inside the root`);
    }
  });

  test(`keeps traversal inside the root (${name})`, () => {
    const resolveRequest = loadResolver(impl, root);
    for (const url of ['/../../etc/passwd', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/a/../../../b']) {
      const { file } = resolveRequest(url);
      assert.ok(file === root || file.startsWith(root + impl.sep), `${url} escaped the root: ${file}`);
    }
  });
}

test('directory index is appended for "/" — the Windows 404 regression', () => {
  const resolveRequest = loadResolver(win32, 'E:\\bix');
  assert.equal(resolveRequest('/').file, 'E:\\bix\\index.html');
});
