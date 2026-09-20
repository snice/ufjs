// Static file serving shared by `fjs dev --web` and `fjs preview`.
//
// The two servers are different beasts — dev builds on request and injects
// a reload snippet; preview serves a finished release site read-only — but
// the FILE semantics must be identical, because both answer the same
// question ("does this URL name a route or a missing asset?"): an
// extension-less path falls back to index.html (a deep link in history
// mode), a missing path WITH an extension is an honest 404 (specs/017 —
// a missing `/images/x.png` that answered 200 with index.html used to
// surface as nothing but a broken image), and `..` never leaves the root.
import fs from 'node:fs';
import path from 'node:path';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

/** Resolves one URL inside [dir]: the file to serve, or null for a 404.
 * [dir] must be resolved. Extension-less paths fall back to the site's
 * index.html (the SPA deep-link case); anything with an extension must
 * exist or the answer is "not found". */
export function resolveStaticFile(dir: string, url: string): string | null {
  const clean = url.split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  // path.join, not resolve: a URL always starts with '/', and resolve would
  // take an absolute second argument as the WHOLE path, dropping [dir]
  const file = path.join(dir, decoded === '/' ? 'index.html' : decoded);
  if (file !== dir && !file.startsWith(dir + path.sep)) return null; // traversal
  if (fs.existsSync(file) && !fs.statSync(file).isDirectory()) return file;
  if (path.extname(decoded)) return null; // a missing asset, not a route
  const index = path.join(dir, 'index.html');
  return fs.existsSync(index) ? index : null;
}
