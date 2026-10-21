import http from 'node:http';
const mode = process.argv[2]; const log = [];
const bodies = {
  r1b: [403, JSON.stringify({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } })],
  html: [403, '<html><body><h1>Error: Forbidden</h1></body></html>'],
  s503: [503, JSON.stringify({ error: { status: 'UNAVAILABLE' } })],
  r200: [200, JSON.stringify({ result: null })],
};
const srv = http.createServer((req, res) => { let b=''; req.on('data', c => b += c); req.on('end', () => {
  log.push(`${req.method} ${req.url} auth=${req.headers.authorization ? 'yes' : 'no'}`);
  if (req.url.includes('/wsfSetCommunityVisibility') || req.url.includes('/wsfCommunityMembers') || req.url.includes('/wsfCommunityActivity')) {
    const [s, t] = mode === 'mixed' && !req.url.includes('/wsfSetCommunityVisibility') ? [401, JSON.stringify({ error: { message: 'x', status: 'UNAUTHENTICATED' } })] : bodies[mode === 'mixed' ? 'r1b' : mode];
    res.writeHead(s, { 'content-type': t.startsWith('<') ? 'text/html' : 'application/json' }); return res.end(t);
  }
  res.writeHead(500); res.end('{}'); // any Auth/Firestore/other call is a WRITE ATTEMPT
}); });
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port; const { spawn } = await import('node:child_process');
  const h = `127.0.0.1:${port}`;
  const r = await new Promise((resolve) => { const c = spawn(process.execPath, ['.github/wsf-staging/social-privacy-postop.mjs'], { env: { ...process.env, WSF_PRIVACY_TARGET: 'emulator', WSF_PRIVACY_PROJECT: 'demo-w5', FIRESTORE_EMULATOR_HOST: h, FIREBASE_AUTH_EMULATOR_HOST: h, WSF_FUNCTIONS_EMULATOR_HOST: h, WSF_RESULT_DIR: `/tmp/w5-491b-res-${mode}`, WSF_CLEANUP_MANIFEST: `/tmp/w5-491b-res-${mode}/manifest.json` } }); let out=''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); c.on('close', (code) => resolve({ status: code, stdout: out })); });
  const nonProbe = log.filter(l => !/wsfSetCommunityVisibility|wsfCommunityMembers|wsfCommunityActivity/.test(l) || /auth=yes/.test(l));
  const m = JSON.parse((await import('node:fs')).readFileSync(`/tmp/w5-491b-res-${mode}/manifest.json`, 'utf8'));
  console.log(`${mode}: exit=${r.status} ${(r.stdout.match(/TRANSPORT [^\n]*/g)||[]).join(' | ')} | ${(r.stdout.match(/SOCIAL_PRIVACY_(VERDICT|READY)=\S+/g)||[]).join(' ')} | rows=${(r.stdout.match(/PRIVACY_ROW_\d=\S+/g)||[]).map(s=>s.split('=')[1]).join(',')} | requests=${log.length} nonProbe/authenticated=${nonProbe.length} manifest users=${m.users.length} docs=${m.docs.length}`);
  srv.close();
});
