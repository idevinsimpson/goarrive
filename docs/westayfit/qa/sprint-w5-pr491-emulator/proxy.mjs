// Tiny fault-injecting proxy in front of the functions emulator. MODE: shut-html | shut-json | internal-activity
import http from 'node:http';
import fs from 'node:fs';
const MODE = process.env.MODE; const PORT = Number(process.env.PORT || 5101);
const UP = { host: '127.0.0.1', port: 5001 };
const LOG = process.env.PROXY_LOG;
const log = (o) => LOG && fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
function who(auth) {
  if (!auth) return null;
  try { const p = JSON.parse(Buffer.from(auth.split(' ')[1].split('.')[1], 'base64url').toString()); return p.email || p.user_id || 'unknown'; } catch { return 'undecodable'; }
}
http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks); const path = req.url.split('?')[0]; const auth = req.headers.authorization;
    const caller = who(auth); const label = caller && typeof caller === 'string' ? (caller.match(/-(champion|member|outsider)@/)?.[1] || caller) : 'anonymous';
    const fn = path.split('/').pop();
    const answer = (status, type, text, why) => { log({ fn, caller: label, action: 'INJECT', status, why }); res.writeHead(status, { 'content-type': type }); res.end(text); };
    if ((MODE === 'shut-html' || MODE === 'shut-json') && path.endsWith('/wsfSetCommunityVisibility')) {
      if (MODE === 'shut-html') return answer(403, 'text/html; charset=UTF-8', '<html><body><h1>Error: Forbidden</h1></body></html>', 'setter shut (html)');
      return answer(403, 'application/json; charset=UTF-8', JSON.stringify({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }), 'setter shut (GFE json)');
    }
    if (MODE === 'internal-activity' && path.endsWith('/wsfCommunityActivity') && auth && label !== 'outsider') {
      return answer(500, 'application/json', JSON.stringify({ error: { message: 'INTERNAL', status: 'INTERNAL' } }), 'missing index simulated');
    }
    const up = http.request({ ...UP, method: req.method, path: req.url, headers: req.headers }, (u) => {
      log({ fn, caller: label, action: 'FORWARD', status: u.statusCode });
      res.writeHead(u.statusCode, u.headers); u.pipe(res);
    });
    up.on('error', (e) => { log({ fn, action: 'UPSTREAM_ERROR', e: e.message }); res.writeHead(502); res.end(); });
    up.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`proxy ${MODE} on ${PORT}`));
