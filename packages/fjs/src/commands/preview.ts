// fjs preview — serve the finished web build (dist/web) the way vite
// preview does: read-only, no build, no reload snippet, no /ws. The point
// is verifying the RELEASE site — real CSS, hashed chunks, the public/
// copy — not re-living the dev loop; `fjs dev --web` owns that.
//
// The file semantics (SPA fallback, honest 404s, traversal confinement)
// come from dev/static.ts, so what a URL means matches the dev server
// byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { MIME, resolveStaticFile } from '../dev/static.js';

interface PreviewOptions {
  outDir: string;
  port: number;
  host: string;
}

export function previewCommand(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const root = process.cwd();
  const web = path.join(path.resolve(opts.outDir), 'web');
  if (!fs.existsSync(path.join(web, 'index.html'))) {
    throw new Error(`no web build at ${path.relative(root, web)} — run fjs build --web first`);
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const file = resolveStaticFile(web, url);
    if (file === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`not found: ${url.split('?')[0]}\n`);
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
    console.log(`served ${path.relative(web, file)} (${body.length} B)`);
  });

  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      console.log(`  ${path.basename(root)} — web preview (release build, read-only)`);
      console.log('');
      console.log(`    http://localhost:${opts.port}/`);
      if (opts.host !== '127.0.0.1' && opts.host !== 'localhost') {
        console.log(`    bound on ${opts.host}:${opts.port}   (LAN)`);
      }
      console.log('');
      console.log('  Ctrl-C to stop');
    });
    server.on('close', resolve);
  });
}

function parseArgs(argv: string[]): PreviewOptions {
  const opts: PreviewOptions = { outDir: 'dist', port: 4173, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[++i];
    if (arg === '--out') opts.outDir = requireValue(value, arg);
    else if (arg === '--port') opts.port = Number(requireValue(value, arg));
    else if (arg === '--host') opts.host = requireValue(value, arg);
    else throw new Error(`unknown preview option: ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0 || opts.port > 65535) {
    throw new Error('--port takes a port number in 1..65535');
  }
  return opts;
}

function requireValue(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} takes a value`);
  return value;
}
