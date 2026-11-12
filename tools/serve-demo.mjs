// A signed-in demo planner for tools that cannot sign in themselves (design inspectors, screenshot tools, a quick look).
//   npm run build && node tools/serve-demo.mjs [--port 3200] [--lang en|tr]
// Starts a throwaway server with a demo account (tools/lib) and a small proxy on --port that adds the demo session
// cookie to every request, so http://localhost:3200/day/<date> opens already signed in. Add ?theme=dark (or light)
// to any page to switch the theme on that browser. Ctrl+C stops it and deletes the temporary data.
// --fresh: a new account that has not been through the first-run setup, so / shows it; add ?step=2 (or 3) to open the
// setup at that step with sample answers (it writes the setup's own draft into the tab).
import { createServer, request } from 'node:http';
import { client, startServer } from './lib/server.mjs';
import { demoAccount, iso } from './lib/demo.mjs';

const arg = (name, def) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : def);
const port = Number(arg('port', 3200)), lang = arg('lang', 'en'), fresh = process.argv.includes('--fresh');

const srv = await startServer();
let api;
if (fresh) {
  api = client(srv.url);
  await api.call('/api/auth/setup', { email: lang === 'tr' ? 'deniz.kuzey@example.test' : 'robin.hale@example.test', password: 'Demo-password-1', signupMode: 'closed', lang });
} else api = await demoAccount(client(srv.url), { lang });
const target = new URL(srv.url);
const THEME = '<script>(function(){var m=/[?&]theme=(dark|light|system)/.exec(location.search);if(m)try{localStorage.setItem("sc-theme",m[1])}catch(e){}'
  + 'var s=/[?&]step=(\\d)/.exec(location.search);if(s)try{var n=+s[1]-1;sessionStorage.setItem("sc-welcome-2",JSON.stringify({step:n,reached:n,person:"' + (lang === 'tr' ? 'Deniz' : 'Robin') + '",uses:["school","personal"],picked:["deep","exercise","sleep"],start:9,end:17,whole:false}))}catch(e){}})()</script>';

createServer((req, res) => {
  const headers = { ...req.headers, host: target.host, cookie: api.cookie };
  if (headers.origin) headers.origin = srv.url;
  delete headers['accept-encoding'];
  const up = request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (r) => {
    const html = (r.headers['content-type'] || '').includes('text/html');
    if (!html) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    // the theme switch has to run before the page's own theme script
    let body = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { body += d; });
    r.on('end', () => {
      const out = body.replace('<head>', `<head>${THEME}`);
      const h = { ...r.headers }; delete h['content-length'];
      res.writeHead(r.statusCode, h); res.end(out);
    });
  });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(port, '127.0.0.1', () => {
  console.log(fresh ? `first-run setup (${lang}) at http://localhost:${port}/  · ?step=2 · Ctrl+C to stop` : `demo planner (${lang}) at http://localhost:${port}/day/${iso(new Date())}  · Ctrl+C to stop`);
});
process.on('SIGINT', () => { srv.stop(); process.exit(0); });
