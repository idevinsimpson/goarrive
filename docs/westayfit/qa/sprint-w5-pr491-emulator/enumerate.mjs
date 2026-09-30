// Enumerate every Firestore doc (recursive) and every Auth user in the emulator; optional diff vs manifest.
import fs from 'node:fs';
const P = process.env.PROJ || 'demo-wsf-local';
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const AU = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${P}`;
const H = { authorization: 'Bearer owner', 'content-type': 'application/json' };
async function colIds(parent) {
  const out = []; let pageToken;
  do {
    const r = await fetch(`${parent}:listCollectionIds`, { method: 'POST', headers: H, body: JSON.stringify({ pageSize: 300, pageToken }) });
    const b = await r.json(); out.push(...(b.collectionIds || [])); pageToken = b.nextPageToken;
  } while (pageToken);
  return out;
}
async function docsIn(colUrl) {
  const out = []; let pageToken;
  do {
    const u = `${colUrl}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const b = await (await fetch(u, { headers: H })).json();
    for (const d of b.documents || []) out.push({ name: d.name, missing: !d.createTime }); pageToken = b.nextPageToken;
  } while (pageToken);
  return out;
}
const all = []; const phantom = [];
async function walk(parentUrl) {
  for (const c of await colIds(parentUrl)) {
    for (const { name, missing } of await docsIn(`${parentUrl}/${c}`)) {
      const rel = name.split('/documents/')[1];
      if (missing) phantom.push(rel); else all.push(rel);
      await walk(`${FS}/${rel}`);
    }
  }
}
await walk(FS);
const ur = await (await fetch(`${AU}/accounts:query`, { method: 'POST', headers: H, body: JSON.stringify({ returnUserInfo: true }) })).json();
const users = (ur.userInfo || []).map((u) => ({ uid: u.localId, email: u.email }));
const res = { phantomParentsNoDoc: phantom, docCount: all.length, userCount: users.length, docs: all.sort(), users };
const tag = process.env.TAG;
if (tag) res.taggedDocs = all.filter((d) => d.includes(tag)), res.taggedUsers = users.filter((u) => (u.email || '').includes(tag));
if (process.env.MANIFEST && fs.existsSync(process.env.MANIFEST)) {
  const m = JSON.parse(fs.readFileSync(process.env.MANIFEST, 'utf8'));
  const md = new Set(m.docs), mu = new Set(m.users);
  res.diff = {
    manifestDocs: m.docs.length, manifestUsers: m.users.length,
    presentNotInManifest: all.filter((d) => !md.has(d)),
    manifestDocsAbsent: m.docs.filter((d) => !all.includes(d)),
    usersNotInManifest: users.filter((u) => !mu.has(u.uid)),
    manifestUsersAbsent: m.users.filter((u) => !users.some((x) => x.uid === u)),
  };
}
console.log(JSON.stringify(res, null, 2));
