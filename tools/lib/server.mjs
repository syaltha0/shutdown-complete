// A throwaway planner for the tools: the built app (npm run build first) on a free port, with its own empty
// database in a temporary folder that is deleted when the tool stops. Real data is never touched.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const ROOT = resolve(import.meta.dirname, '../..');

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/**
 * `env`: extra environment for the server (for example CALENDAR_ALLOW_PRIVATE=on, to read a test feed on this machine).
 * `dataDir`: start on the data of an earlier one (a restart); that folder is then left for its first owner to delete.
 */
export async function startServer({ env = {}, dataDir } = {}) {
  if (!existsSync(join(ROOT, 'client/dist/index.html'))) throw new Error('Build the client first: npm run build');
  const dir = dataDir ?? mkdtempSync(join(tmpdir(), 'shutdown-complete-tool-'));
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/src/index.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, STATIC_DIR: join(ROOT, 'client/dist'), NODE_ENV: 'development', SMTP_URL: '', APP_URL: '', ...env },
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const stop = () => {
    try { proc.kill(); } catch { /* gone */ }
    if (!dataDir) try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* busy */ }
  };
  process.once('exit', stop);
  const exited = new Promise((ok) => proc.once('exit', ok));
  return { url, stop, log: () => log, dir, exited };
}

/** A signed-in API client for one account (keeps its own session cookie). */
export function client(url) {
  let cookie = '';
  const call = async (path, body, method) => {
    const r = await fetch(url + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    call,
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
    async put(key, value) {
      const cur = (await call(`/api/doc/${key}`)).body;
      const r = await call(`/api/doc/${key}`, { value, version: cur.version }, 'PUT');
      if (r.status !== 200) throw new Error(`${key}: ${r.status}`);
      return r.body;
    },
    async get(key) { return (await call(`/api/doc/${key}`)).body; },
  };
}
