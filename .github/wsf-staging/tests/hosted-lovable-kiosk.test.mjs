#!/usr/bin/env node
/**
 * hosted-lovable-kiosk.mjs, offline: the exact-host check, the served-build binding (empty, changed, extra, missing,
 * exact), the receipt and verdict rules, the run-tagged cleanup merge, and the journey against a scripted fake of the
 * Lovable UI and the existing fixture kit. No network, no credential, no browser.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  API_ORIGINS, BIND_PROBES, FIXED_BLOCKED, LOVABLE_URL, ROUTE_TEMPLATES, assetTypeProblem, callableLog, canonicalDocument, cli, REVIEWED_BUILD, ROWS, allPassed, bindBuild,
  bindLines, browserEnv, checkBase, classifyRequest, codeGuard, documentTypeProblem, hostBuildRow, idHash, matchTemplate, mergeIntoManifest, ownCreditOf, receiptVerdict,
  requireVerdict, results, runJourney, runResults, servedManifest, sharedOf, showsNumber,
} from '../hosted-lovable-kiosk.mjs';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- host and build binding ----------------------------------------------------------------------
test('only exactly the Lovable host is accepted', () => {
  assert.deepEqual(checkBase(LOVABLE_URL), { ok: true, base: LOVABLE_URL });
  assert.equal(checkBase(`${LOVABLE_URL}/`).ok, true);
  for (const bad of ['http://we-stay-fit-foundation-trial.lovable.app', 'https://id-preview--e15b9fa0-b2a0-4314-bc21-9c573b8eceb1.lovable.app',
    `${LOVABLE_URL}/kiosk`, `${LOVABLE_URL}/?x=1`, `${LOVABLE_URL}#a`, 'https://user:pw@we-stay-fit-foundation-trial.lovable.app', 'https://we-stay-fit-foundation-trial.lovable.app.evil.test',
    'https://westayfit-staging--staging-4a616y5m.web.app', '', undefined, 'not a url']) {
    assert.equal(checkBase(bad).ok, false, String(bad));
  }
});

/**
 * A document as the TanStack Start host serves it (HTML-VARIANCE-1, #365 6089082668 and 6089534129): the host's
 * events script tag with a per-request context token, the stream part with one per-request `u:` per matched route, and
 * the route's own params in its markup and stream part. `o` switches in one defect at a time.
 */
let served = 0;
// The hosting's preview screenshot links (step C): DEEPLINK-DRIFT-CONFIRM-1's verbatim elements (#394 6093468966).
const SHOT_A = 'a74c72a1c0451cab76648ebdb57437a9_1791601764778';
const SHOT_B = '0f1e2d3c4b5a69788796a5b4c3d2e1f0_1791603000123';
const SHOT_URL = 'https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/lovp_372ahwppkw9debd61922xf2ayz/';
const shotTags = (a, b = a) => `<meta property="og:image" content="${SHOT_URL}${a}.png"><meta name="twitter:image" content="${SHOT_URL}${b}.png">`;
const ROOT_OG = '<meta property="og:image" content="https://we-stay-fit-foundation-trial.lovable.app/og-share.jpg"/><meta name="twitter:image" content="https://we-stay-fit-foundation-trial.lovable.app/og-share.jpg"/>';
function servedDoc(pathname, o = {}) {
  served += 1;
  const token = o.token ?? `ctx.${crypto.randomBytes(12).toString('base64url')}`;
  const ts = o.ts ?? `${1 + crypto.randomInt(9)}${String(crypto.randomInt(1e12)).padStart(12, '0')}`; // any 13 digits, per request
  const segs = pathname.split('/').filter(Boolean);
  const route = pathname === '/' ? '/' : segs[0] === 'display' ? '/display/$goalId' : '/kiosk/$communityId/$goalId';
  const ids = o.ids ?? segs.slice(1);
  const matchId = ids.length ? `${route}/${segs[0]}/${ids.join('/')}` : '/';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"${o.metaAttr ?? ''}><title>WE STAY FIT</title>`
    + `<link rel="stylesheet" href="/assets/index-CCC.css"><link rel="modulepreload" href="/assets/${o.shell ?? 'shell-AAA.js'}">`
    + `${o.eventsPre ?? '<script src="/__l5e/events.a1b2c3d4e5f60718.js" '}data-context-token="${token}"${o.tokenTail ?? ''} defer></script><script src="/~flock.js" defer></script>${o.head ?? ''}`
    + `${o.shotTags ?? (route === '/' ? ROOT_OG : shotTags(o.shot ?? SHOT_A, o.shot2 ?? o.shot ?? SHOT_A))}</head>`
    + `<body><main data-route="${route}"${ids.map((v, i) => ` data-p${i}="${v}"`).join('')}>\u0000</main>`
    + `<script class="$tsr" data-tsr-stream-part="">$_TSR.router.matches=[{i:"__root__",u:${o.u1 ?? ts},s:"success",x:"\u0000"},{i:"${matchId}",u:${o.u2 ?? ts},s:"${o.status ?? 'success'}"}${o.streamMore ?? ''}]</script>`
    + `${o.body ?? ''}<script type="module" src="/assets/${o.shell ?? 'shell-AAA.js'}"></script></body></html>`;
}
const pin = (d) => ({ sha256: d.sha256, streamU: d.streamU, nul: d.nul, img: d.img });
const canonOf = (p, o) => canonicalDocument(servedDoc(p, o), `${LOVABLE_URL}${p}`);

function site(files) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, 'error', 'redirects are never followed');
    const p = new URL(url).pathname;
    const body = p.startsWith('/assets/') ? files.assets[p] : files.doc(p);
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const type = p.startsWith('/assets/') ? (files.assetType?.(p) ?? 'text/javascript') : (files.docType?.(p) ?? 'text/html; charset=utf-8');
    return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => Buffer.from(body) };
  };
  return { fetchImpl, calls };
}
const SITE = {
  doc: (p) => servedDoc(p),
  assets: {
    '/assets/shell-AAA.js': 'import("./connected-kiosk-BBB.js");import "https://cdn.example.test/assets/evil.js";',
    '/assets/connected-kiosk-BBB.js': 'export const k=1;',
    '/assets/index-CCC.css': 'body{}',
  },
};
const OBSERVED = { 'connected-kiosk-BBB.js': sha(SITE.assets['/assets/connected-kiosk-BBB.js']), 'index-CCC.css': sha(SITE.assets['/assets/index-CCC.css']), 'shell-AAA.js': sha(SITE.assets['/assets/shell-AAA.js']) };
const DOCS = Object.freeze({
  '/': pin(canonOf('/')),
  '/display/$goalId': pin(canonOf('/display/ga1-wsf-bind-probe')),
  '/kiosk/$communityId/$goalId': pin(canonOf('/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe')),
});
const EXACT = Object.freeze({ documents: DOCS, assets: OBSERVED });

// ---- the route-aware document binding (LOVABLE-REVIEWED-BUILD-1, queue #365 6090733639) ------------------------
test('route templates: exactly /, /display/<goal> and /kiosk/<community>/<goal>; every other path is no template', () => {
  assert.deepEqual(ROUTE_TEMPLATES, ['/', '/display/$goalId', '/kiosk/$communityId/$goalId']);
  assert.deepEqual(matchTemplate('/'), { template: '/', params: {} });
  assert.deepEqual(matchTemplate('/display/e5cgoal-e5c-t-1-dm1'), { template: '/display/$goalId', params: { goalId: 'e5cgoal-e5c-t-1-dm1' } });
  assert.deepEqual(matchTemplate('/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk'), { template: '/kiosk/$communityId/$goalId', params: { communityId: 'e5cgrp-e5c-t-1-lk', goalId: 'e5cgoal-e5c-t-1-lk' } });
  for (const p of ['', '/display', '/display/', '/display/a/b', '/kiosk/a', '/kiosk/a/b/c', '/c/a/g/b', '/go/marker', '/try', '/review/x', '//', '/index.html']) assert.equal(matchTemplate(p), null, p);
  assert.deepEqual([...new Set(BIND_PROBES.map((p) => matchTemplate(new URL(`${LOVABLE_URL}${p}`).pathname)?.template))], ROUTE_TEMPLATES, 'the bind loads every template, and only templates');
});

test('canonical document: exactly the two per-request values are normalized, and the URL\'s own params fill their slots', () => {
  const a = canonOf('/');
  const b = canonOf('/');
  assert.equal(a.template, '/');
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.sha256, b.sha256, 'two requests (other token, other timestamps) reduce to one document');
  assert.equal(a.streamU, 2, 'one u: per matched route');
  assert.equal(canonOf('/', { token: 'abcdefgh' }).sha256, a.sha256, 'an 8-character token is the token');
  assert.equal(canonOf('/', { token: 'A'.repeat(4096) }).sha256, a.sha256, 'and so is a 4096-character one');
  // Step C: the hosting's preview screenshot file name is a slot on a param template, so a regeneration (another file
  // name in both links) is the same document; `/` carries none.
  for (const P of ['/display/ga1-wsf-bind-probe', '/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe']) {
    const shotA = canonOf(P, { shot: SHOT_A });
    const shotB = canonOf(P, { shot: SHOT_B });
    assert.equal(shotA.sha256, shotB.sha256, `${P}: two screenshot file names reduce to one document`);
    assert.deepEqual([shotA.img, shotA.previewImages, shotB.previewImages], [2, [SHOT_A], [SHOT_B]], `${P}: two links, and the name each load carried`);
  }
  assert.deepEqual([a.img, a.previewImages], [0, []], '`/` carries no screenshot link');
  // F7 (W3): `bom` means a document STARTS with a BOM; one inside it is a byte like any other.
  assert.equal(canonOf('/', { body: '\uFEFF' }).bom, false);
  assert.equal(canonicalDocument(`\uFEFF${servedDoc('/')}`, `${LOVABLE_URL}/`).bom, true);
  assert.equal(canonicalDocument(servedDoc('/'), `${LOVABLE_URL}/?join=jn1-wsf-bind-probe&goal=ga1-wsf-bind-probe`).sha256, a.sha256, 'the query string never reaches the document');
  const d1 = canonOf('/display/ga1-wsf-bind-probe');
  const d2 = canonOf('/display/Zq9wsfBindProbeGoal2');
  assert.equal(d1.sha256, d2.sha256, 'two goal ids reduce to one display document');
  assert.deepEqual(d1.params, { goalId: 2 }, 'the id is counted where it appears (markup and stream part)');
  assert.notEqual(d1.sha256, a.sha256);
  const k1 = canonOf('/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe');
  assert.equal(k1.sha256, canonOf('/kiosk/Xk4wsfBindProbeComm2/Zq9wsfBindProbeGoal2').sha256);
  assert.deepEqual(k1.params, { communityId: 2, goalId: 2 });
  assert.notEqual(k1.sha256, d1.sha256);
  // A fixed vector (R3): the canonical form of a small document is exactly this JSON list of literal text and slots.
  // (A param template, so the vector carries the hosting's two preview links, step C.)
  const vectorDoc = `<meta property="og:image" content="${SHOT_URL}${SHOT_A}.png"><meta name="twitter:image" content="${SHOT_URL}${SHOT_A}.png"><p data-context-token="tok12345">x</p><script data-tsr-stream-part="">a={u:1234567890123};b="\u0000"</script><i>abcdefghijkl0</i>`;
  const vectorJson = `["<meta property=\\"og:image\\" content=\\"${SHOT_URL}",{"slot":"preview-image"},".png\\"><meta name=\\"twitter:image\\" content=\\"${SHOT_URL}",{"slot":"preview-image"},".png\\"><p data-context-token=\\"",{"slot":"token"},"\\">x</p><script data-tsr-stream-part=\\"\\">a={u:",{"slot":"u"},"};b=\\"\\u0000\\"</script><i>",{"slot":"param:goalId"},"</i>"]`;
  const vector = canonicalDocument(vectorDoc, `${LOVABLE_URL}/display/abcdefghijkl0`);
  assert.equal(vector.sha256, sha(vectorJson), 'the digest is the sha256 of exactly that JSON');
  assert.equal(vector.sha256, VECTOR_SHA256, 'and that JSON is pinned');
  assert.deepEqual([vector.streamU, vector.nul, vector.img, vector.previewImages, vector.params], [1, 1, 2, [SHOT_A], { goalId: 1 }]);
  // A second fixed vector with non-ASCII text (#394 6092810294 item 8): the canonical JSON is hashed as UTF-8.
  const vector2Doc = `<meta property="og:image" content="${SHOT_URL}${SHOT_A}.png"><meta name="twitter:image" content="${SHOT_URL}${SHOT_A}.png"><p data-context-token="tok12345">é — 😀 \u2028 ü</p><script data-tsr-stream-part="">a={u:1234567890123}</script><i>abcdefghijkl0</i>`;
  const vector2Json = `["<meta property=\\"og:image\\" content=\\"${SHOT_URL}",{"slot":"preview-image"},".png\\"><meta name=\\"twitter:image\\" content=\\"${SHOT_URL}",{"slot":"preview-image"},".png\\"><p data-context-token=\\"",{"slot":"token"},"\\">é — 😀 \u2028 ü</p><script data-tsr-stream-part=\\"\\">a={u:",{"slot":"u"},"}</script><i>",{"slot":"param:goalId"},"</i>"]`;
  const vector2 = canonicalDocument(vector2Doc, `${LOVABLE_URL}/display/abcdefghijkl0`);
  assert.equal(vector2.sha256, crypto.createHash('sha256').update(Buffer.from(vector2Json, 'utf8')).digest('hex'), 'the digest is the sha256 of that JSON in UTF-8');
  assert.equal(vector2.sha256, VECTOR2_SHA256, 'and that JSON is pinned');
  assert.notEqual(vector2.sha256, crypto.createHash('sha256').update(Buffer.from(vector2Json, 'latin1')).digest('hex'), 'not its latin1 bytes');
  // Only a u: KEY counts: the tail of another name (menu:, menu:abc) is neither a timestamp nor a refusal.
  const menu = canonicalDocument(servedDoc('/', { streamMore: ',{menu:"open",emu:1}' }), `${LOVABLE_URL}/`);
  assert.equal(menu.streamU, 2);
  assert.notEqual(menu.sha256, a.sha256, 'and it is kept byte for byte');
  // A u: outside the stream part is not normalized: it stays exact, so another value is another document.
  const after1 = canonicalDocument(servedDoc('/', { body: '<script>x={u:1760050000001}</script>' }), `${LOVABLE_URL}/`);
  const after2 = canonicalDocument(servedDoc('/', { body: '<script>x={u:1760050000002}</script>' }), `${LOVABLE_URL}/`);
  assert.equal(after1.streamU, 2, 'only the stream part\'s u: values are counted');
  assert.notEqual(after1.sha256, after2.sha256);
  // A character whose lower case is longer (İ) before the stream part never shifts where the stream part ends.
  const wide = (o) => canonicalDocument(servedDoc('/', { head: `<title>${'İ'.repeat(40)}</title>`, ...o }), `${LOVABLE_URL}/`);
  assert.equal(wide({ body: '<script>x={u:1760050000001}</script>' }).streamU, 2);
  assert.equal(wide().sha256, wide().sha256, 'and two requests still reduce to one document');
  assert.match(canonicalDocument(servedDoc('/').replace(/(data-tsr-stream-part="">[^<]*)<\/script>[^]*$/, '$1'), `${LOVABLE_URL}/`).reason, /stream-part script is not closed/);
  // NUL characters are document bytes like any other (the real host's documents carry them): kept, never a slot.
  assert.ok(servedDoc('/').includes('\u0000'), 'the fake documents carry NULs, as the real ones do');
  assert.equal(a.nul, 2, 'every NUL is counted');
  assert.deepEqual(a.nulClasses, { stream: 1, script: 0, markup: 1 }, 'and classed by where it stands');
  assert.deepEqual(canonOf('/', { body: '<script>x="\u0000\u0000"</script>' }).nulClasses, { stream: 1, script: 2, markup: 1 }, 'another inline script is its own class');
  const fewer = canonicalDocument(servedDoc('/').replace('\u0000</main>', '</main>'), `${LOVABLE_URL}/`);
  assert.equal(fewer.nul, 1);
  assert.notEqual(fewer.sha256, a.sha256, 'removing one NUL changes the digest');
  // A literal NUL + wsf:token + NUL (the in-band spelling of a slot) is text like any other: never a slot.
  const tokenSpelled = canonOf('/', { body: '<p>\u0000wsf:token\u0000</p>' });
  assert.match(tokenSpelled.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(tokenSpelled.sha256, canonOf('/', { body: '<p></p>' }).sha256);
  assert.equal(tokenSpelled.nul, 4);
  assert.equal(canonOf('/', { body: '\u0000\u0000' }).sha256, canonOf('/', { body: '\u0000\u0000' }).sha256);
  assert.notEqual(canonOf('/', { body: '\u0000\u0000' }).sha256, canonOf('/', { body: '\u0000 \u0000' }).sha256);
  // Literal text never stands for a slot: a document that spells a slot (in-band, as a NUL-delimited marker) where the
  // other carries the id itself does not reduce to the same document.
  const withId = servedDoc('/display/ga1-wsf-bind-probe');
  const spelled = withId.replace('data-p0="ga1-wsf-bind-probe"', 'data-p0="\u0000wsf:param:goalId\u0000"');
  assert.notEqual(spelled, withId);
  assert.notEqual(canonicalDocument(spelled, `${LOVABLE_URL}/display/ga1-wsf-bind-probe`).sha256, canonicalDocument(withId, `${LOVABLE_URL}/display/ga1-wsf-bind-probe`).sha256);
  // The token's value never reaches a result.
  const token = 'tokSECRETvalue.abcDEF123';
  assert.doesNotMatch(JSON.stringify(canonicalDocument(servedDoc('/', { token }), `${LOVABLE_URL}/`)), /tokSECRET/);
  assert.doesNotMatch(JSON.stringify(canonicalDocument(servedDoc('/', { token: 'tok>SECRET12345' }), `${LOVABLE_URL}/`)), /tokSECRET|SECRET12345/, 'not in a refusal either');
});

test('negative mutations: each one is refused, by name or by digest, at bind and in the browser guard', async () => {
  const G = '/display/ga1-wsf-bind-probe';
  const K = '/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe';
  const mutants = [
    ['a changed script src', '/', servedDoc('/', { shell: 'shell-ZZZ.js' }), /differs from the reviewed \/ document/],
    ['an added inline script', '/', servedDoc('/', { body: '<script>steal()</script>' }), /differs from the reviewed \/ document/],
    ['an inline-script change outside u:', G, servedDoc(G, { status: 'error' }), /differs from the reviewed \/display\/\$goalId document/],
    ['a changed attribute other than the token', '/', servedDoc('/', { metaAttr: ' data-x="1"' }), /differs from the reviewed \/ document/],
    ['a token value carrying a quote', '/', servedDoc('/', { token: 'abcdefgh"x' }), /data-context-token value is not one quoted token/],
    ['a token value carrying >', '/', servedDoc('/', { token: 'abcd>efgh1234' }), /data-context-token value is not one quoted token .*angle bracket/],
    ['a token followed by a second attribute', '/', servedDoc('/', { tokenTail: ' onload="steal()"' }), /differs from the reviewed \/ document/],
    ['a non-digit u:', '/', servedDoc('/', { u2: '17600500000a0' }), /1 of the 2 u: values in the stream part are not 13 digits/],
    ['a 14-digit u:', '/', servedDoc('/', { u1: '17600500000001' }), /not 13 digits/],
    ['an extra stream-part script', '/', servedDoc('/', { body: '<script data-tsr-stream-part="">$_TSR.x=1</script>' }), /2 data-tsr-stream-part scripts, not exactly 1/],
    ['an extra u: in the stream part', '/', servedDoc('/', { streamMore: ',{i:"/x",u:1760050000000,s:"success"}' }), /carries 3 stream-part u: value\(s\), not the reviewed 2/],
    ['a param that is not the URL\'s', G, servedDoc(G, { ids: ['Zq9wsfBindProbeGoal2'] }), /differs from the reviewed \/display\/\$goalId document/],
    ['a kiosk document for another community', K, servedDoc(K, { ids: ['Xk4wsfBindProbeComm2', 'ga1-wsf-bind-probe'] }), /differs from the reviewed \/kiosk/],
    ['an unknown template', '/c/ca1-wsf-bind-probe/g/ga1-wsf-bind-probe', servedDoc('/'), /is not a reviewed route template/],
    ['a second context token', '/', servedDoc('/', { head: '<script src="/__l5e/events.a1b2c3d4e5f60718.js" data-context-token="abcdefgh1234"></script>' }), /2 data-context-token attributes, not exactly 1/],
    ['no context token', '/', servedDoc('/').replace(/ data-context-token="[^"]*"/, ''), /0 data-context-token attributes/],
    ['the only context token inside the stream part', '/', servedDoc('/').replace(/ data-context-token="[^"]*"/, '').replace('$_TSR.router', 'x=\'<a data-context-token="abcdefgh1234">\';$_TSR.router'), /data-context-token attribute is inside the stream part/],
    ['an added NUL character', '/', servedDoc('/', { body: '\u0000' }), /carries 3 NUL character\(s\), not the reviewed 2/],
    ['a removed NUL character', '/', servedDoc('/').replace('\u0000</main>', '</main>'), /carries 1 NUL character\(s\), not the reviewed 2/],
    ['a moved NUL character', '/', servedDoc('/').replace('\u0000</main>', '</main>').replace('<title>', '<title>\u0000'), /differs from the reviewed \/ document/],
    ['a second ~flock.js tag', '/', servedDoc('/', { head: '<script src="/~flock.js" defer></script>' }), /differs from the reviewed \/ document/],
    // R1: a leading BOM is a byte difference (kept by the decoder, so the canonical form differs)
    ['a leading BOM', '/', `\uFEFF${servedDoc('/')}`, /differs from the reviewed \/ document/],
    // R2: the tag that carries the token: its src and the attributes before the token are bound
    ['the events tag src made a data: URL', '/', servedDoc('/', { eventsPre: '<script src="data:text/javascript,steal()" ' }), /differs from the reviewed \/ document/],
    ['the events tag src made another asset', '/', servedDoc('/', { eventsPre: '<script src="/assets/shell-AAA.js" ' }), /differs from the reviewed \/ document/],
    ['an attribute added before the token', '/', servedDoc('/', { eventsPre: '<script src="/__l5e/events.a1b2c3d4e5f60718.js" async ' }), /differs from the reviewed \/ document/],
    ['an attribute changed before the token', '/', servedDoc('/', { eventsPre: '<script src="/__l5e/events.a1b2c3d4e5f60719.js" ' }), /differs from the reviewed \/ document/],
    // R3: a slot's position and presence are bound, not only the literal text around it
    ['the URL\'s param removed', G, servedDoc(G).replace('data-p0="ga1-wsf-bind-probe"', 'data-p0=""'), /differs from the reviewed \/display\/\$goalId document/],
    ['the URL\'s param inserted in the stream part', G, servedDoc(G).replace('$_TSR.router.matches=', 'ga1-wsf-bind-probe$_TSR.router.matches='), /differs from the reviewed \/display\/\$goalId document/],
    ['the URL\'s param moved', G, servedDoc(G).replace('data-p0="ga1-wsf-bind-probe"', 'data-p0=""').replace('<title>', '<title>ga1-wsf-bind-probe'), /differs from the reviewed \/display\/\$goalId document/],
    // N1: the two params of a kiosk document swapped between their slots
    ['the kiosk params swapped', K, servedDoc(K, { ids: ['ga1-wsf-bind-probe', 'ca1-wsf-bind-probe'] }), /differs from the reviewed \/kiosk/],
    // R4: the bytes right beside each cut are kept, and each cut is exactly its value
    ['the byte after a u: value changed', '/', servedDoc('/').replace(/(u:\d{13}),/, '$1;'), /differs from the reviewed \/ document/],
    ['the byte after the token changed', '/', servedDoc('/').replace(/(data-context-token="[^"]*") defer/, '$1\ndefer'), /differs from the reviewed \/ document/],
    ['a 12-digit u:', '/', servedDoc('/', { u1: '176005000000' }), /not 13 digits/],
    ['a 7-character token', '/', servedDoc('/', { token: 'abcdefg' }), /data-context-token value is not one quoted token/],
    // The token's upper bound (LOVABLE-REVIEWED-BUILD-2): 4096 characters, and not one more
    ['a 4097-character token', '/', servedDoc('/', { token: 'a'.repeat(4097) }), /data-context-token value is not one quoted token .*not 8-4096 characters/],
    // R7: the browser must decode the verified text: a document declared in another charset, or not as HTML, is refused
    ['a reviewed document served as windows-1252', '/', servedDoc('/'), /served with charset windows-1252, not UTF-8/, 'text/html; charset=windows-1252'],
    ['a reviewed document served as utf-16le', '/', servedDoc('/'), /served with charset utf-16le, not UTF-8/, 'text/html; charset=utf-16le'],
    ['a reviewed document served as windows-1252, the parameter in upper case', '/', servedDoc('/'), /served with charset windows-1252, not UTF-8/, 'text/html; CHARSET=windows-1252'],
    ['a reviewed document served as text/plain', '/', servedDoc('/'), /served as another content type, not text\/html/, 'text/plain; charset=utf-8'],
    ['a reviewed document served with no content type', '/', servedDoc('/'), /served as no content type, not text\/html/, ''],
    // Step C (#394 6093458108): the preview screenshot link, exactly two on a param template, the same file in both,
    // in exactly its attribute, and the file-name shape nowhere else; none on `/`
    ['a 33-hex screenshot file name', G, servedDoc(G, { shot: `a${SHOT_A}` }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a 31-hex screenshot file name', G, servedDoc(G, { shot: SHOT_A.slice(1) }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a 14-digit screenshot timestamp', G, servedDoc(G, { shot: `${SHOT_A}0` }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a 12-digit screenshot timestamp', G, servedDoc(G, { shot: SHOT_A.slice(0, -1) }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['an upper-case screenshot file name', G, servedDoc(G, { shot: SHOT_A.toUpperCase() }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a quote inside the file name', G, servedDoc(G, { shot: `${SHOT_A.slice(0, 16)}"${SHOT_A.slice(17)}` }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a < inside the file name', G, servedDoc(G, { shot: `${SHOT_A.slice(0, 16)}<${SHOT_A.slice(17)}` }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a space inside the file name', G, servedDoc(G, { shot: `${SHOT_A.slice(0, 16)} ${SHOT_A.slice(17)}` }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['one screenshot link moved into <body>', G, servedDoc(G, { shotTags: shotTags(SHOT_A).split('><')[0] + '>', body: `<meta name="twitter:image" content="${SHOT_URL}${SHOT_A}.png">` }), /differs from the reviewed \/display\/\$goalId document/],
    ['one screenshot link moved into the stream part', G, servedDoc(G, { shotTags: shotTags(SHOT_A).split('><')[0] + '>', streamMore: `,{x:'<meta name="twitter:image" content="${SHOT_URL}${SHOT_A}.png">'}` }), /a preview-image link is inside the stream part/],
    ['one screenshot link moved into another attribute', G, servedDoc(G, { shotTags: shotTags(SHOT_A).replace('name="twitter:image" content=', 'name="twitter:image" data-src=') }), /1 hosting preview-image link\(s\), not exactly 2/],
    ['one screenshot link in a data-content attribute', G, servedDoc(G, { shotTags: shotTags(SHOT_A).replace('name="twitter:image" content=', 'name="twitter:image" data-content=') }), /1 hosting preview-image link\(s\), not exactly 2/],
    ['a third screenshot link', G, servedDoc(G, { shotTags: `${shotTags(SHOT_A)}<meta property="og:image:secure_url" content="${SHOT_URL}${SHOT_A}.png">` }), /3 hosting preview-image link\(s\), not exactly 2/],
    ['a missing screenshot link', G, servedDoc(G, { shotTags: shotTags(SHOT_A).split('><')[0] + '>' }), /1 hosting preview-image link\(s\), not exactly 2/],
    ['two screenshot links naming different files', G, servedDoc(G, { shot: SHOT_A, shot2: SHOT_B }), /the two preview-image links name different files/],
    ['another bucket host', G, servedDoc(G, { shotTags: shotTags(SHOT_A).replaceAll('pub-bb2e103a32db4e198524a2e9ed8f35b4', 'pub-cc2e103a32db4e198524a2e9ed8f35b4') }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['a look-alike bucket host (a dot replaced)', G, servedDoc(G, { shotTags: shotTags(SHOT_A).replaceAll('b4.r2.dev', 'b4xr2.dev') }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['another lovp_ segment', G, servedDoc(G, { shotTags: shotTags(SHOT_A).replaceAll('lovp_372ahwppkw9debd61922xf2ayz', 'lovp_472ahwppkw9debd61922xf2ayz') }), /0 hosting preview-image link\(s\), not exactly 2/],
    ['the file-name shape outside the links', G, servedDoc(G, { body: `<p>${SHOT_B}</p>` }), /the preview-image file-name shape appears 1 time\(s\) outside the preview-image links/],
    ['a screenshot link on /', '/', servedDoc('/', { shotTags: shotTags(SHOT_A) }), /2 hosting preview-image link\(s\), not exactly 0/],
    ['the kiosk with one screenshot link', K, servedDoc(K, { shotTags: shotTags(SHOT_A).split('><')[0] + '>' }), /1 hosting preview-image link\(s\), not exactly 2/],
    ['a param the guard cannot bind', '/display/short', servedDoc('/display/short'), /a path param the guard cannot bind/],
    ['overlapping params', '/kiosk/abcdefghijkl/abcdefghijklmn', servedDoc('/kiosk/abcdefghijkl/abcdefghijklmn'), /two path params overlap/],
  ];
  for (const [name, p, body, why, type = 'text/html; charset=utf-8'] of mutants) {
    const g = codeGuard(EXACT);
    const out = {};
    await g.handle({
      request: () => ({ url: () => `${LOVABLE_URL}${p}`, resourceType: () => 'document', isNavigationRequest: () => true }),
      async fetch() { return { status: () => 200, headers: () => ({ 'content-type': type }), body: async () => Buffer.from(body) }; },
      async fulfill() { out.fulfilled = true; },
      async continue() { out.continued = true; },
      async abort(code) { out.aborted = code; },
    });
    assert.equal(out.fulfilled, undefined, `${name}: never fulfilled`);
    assert.equal(out.aborted, 'blockedbyclient', name);
    assert.match(g.summary().violations[0] ?? '', why, name);
    assert.throws(() => g.check(), /served code outside the reviewed build/, name);
    if (matchTemplate(p) && PARAM_OK(p) && type === 'text/html; charset=utf-8') {
      const c = canonicalDocument(body, `${LOVABLE_URL}${p}`);
      const t = matchTemplate(p).template;
      assert.ok(!c.sha256 || c.sha256 !== DOCS[t].sha256 || c.streamU !== DOCS[t].streamU, `${name}: the bind's canonical form differs too`);
    }
  }
  // The guard compares the reviewed preview-image count too (step C): the same canonical bytes with another count refuse.
  const gi = codeGuard({ documents: { ...DOCS, '/display/$goalId': { ...DOCS['/display/$goalId'], img: 1 } }, assets: OBSERVED });
  const gio = {};
  await gi.handle({
    request: () => ({ url: () => `${LOVABLE_URL}${G}`, resourceType: () => 'document', isNavigationRequest: () => true }),
    async fetch() { return { status: () => 200, headers: () => ({ 'content-type': 'text/html; charset=utf-8' }), body: async () => Buffer.from(servedDoc(G)) }; },
    async fulfill() { gio.fulfilled = true; }, async abort(code) { gio.aborted = code; }, async continue() {},
  });
  assert.deepEqual([gio, gi.summary().violations], [{ aborted: 'blockedbyclient' }, [`document ${LOVABLE_URL}${G} carries 2 preview-image link(s), not the reviewed 1`]]);
  // Not valid UTF-8: refused before it is read as text.
  const g = codeGuard(EXACT);
  await g.handle({
    request: () => ({ url: () => `${LOVABLE_URL}/`, resourceType: () => 'document', isNavigationRequest: () => true }),
    async fetch() { return { status: () => 200, headers: () => ({ 'content-type': 'text/html; charset=utf-8' }), body: async () => Buffer.concat([Buffer.from(servedDoc('/')), Buffer.from([0xff, 0xfe])]) }; },
    async fulfill() { throw new Error('fulfilled'); }, async abort() {}, async continue() {},
  });
  assert.match(g.summary().violations[0], /is not valid UTF-8/);
});
const VECTOR_SHA256 = 'b7316f8eec218dba957cbc37a70d17ab0e6921f2e271dbcbb118249b9fff007f';
const VECTOR2_SHA256 = '6aa341dba75482cdb2690e6822582fde8984e95190d3b1c672386283483ecf39';
const PARAM_OK = (p) => Object.values(matchTemplate(p).params).every((v) => /^[A-Za-z0-9_-]{12,128}$/.test(v));

test('the served manifest: every bind probe reduced per template, same-origin assets walked and hashed, references checked', async () => {
  const s = site(SITE);
  const m = await servedManifest(s.fetchImpl);
  assert.deepEqual(Object.fromEntries(Object.entries(m.documents).map(([t, d]) => [t, pin(d)])), DOCS, 'one canonical document per template, from all of its loads');
  assert.ok(ROUTE_TEMPLATES.every((t) => JSON.stringify(m.documents[t].nulClasses) === JSON.stringify({ stream: 1, script: 0, markup: 1 })), 'with the class of each NUL, for the bind lines');
  assert.deepEqual(m.assets, OBSERVED);
  assert.deepEqual(m.refusals, [], 'the documents load nothing the guard would refuse (the host events script is blocked, not refused)');
  assert.deepEqual(m.probes.map((x) => x.path), [...BIND_PROBES]);
  assert.ok(m.probes.every((x) => x.sha256), 'every probe reduced');
  assert.deepEqual(s.calls.slice(0, BIND_PROBES.length), BIND_PROBES.map((p) => `${LOVABLE_URL}${p}`), 'the probes first, exactly');
  assert.ok(s.calls.every((u) => u.startsWith(`${LOVABLE_URL}/`)), 'never another origin');
  await assert.rejects(servedManifest(site({ ...SITE, assets: { ...SITE.assets, '/assets/connected-kiosk-BBB.js': undefined } }).fetchImpl), /HTTP 404|answered/);
  await assert.rejects(servedManifest(site({ doc: (p) => servedDoc(p).replace(/<link[^>]*>|<script type="module"[^>]*><\/script>/g, ''), assets: {} }).fetchImpl), /name no asset/);
  await assert.rejects(servedManifest(site({ ...SITE, doc: (p) => (p === '/' ? servedDoc(p) : undefined) }).fetchImpl), /\/display\/ga1-wsf-bind-probe answered HTTP 404/);
  // An asset only a deep link loads (its route chunk, preloaded by the server render) is walked and pinned too.
  const routeChunk = site({ doc: (p) => servedDoc(p, p.startsWith('/display/') ? { head: '<link rel="modulepreload" href="/assets/display-DDD.js">' } : {}), assets: { ...SITE.assets, '/assets/display-DDD.js': 'export const d=1;' } });
  const rc = await servedManifest(routeChunk.fetchImpl);
  assert.equal(rc.assets['display-DDD.js'], sha('export const d=1;'));
  assert.deepEqual(rc.refusals, [], 'so the guard would verify it, not refuse it');
  // Route data beyond the URL's own params: a display document that carries something derived from its id.
  const derived = await servedManifest(site({ ...SITE, doc: (p) => (p.startsWith('/display/') ? servedDoc(p, { body: `<p>${p.length}</p>` }) : servedDoc(p)) }).fetchImpl);
  assert.equal(derived.documents['/display/$goalId'].sha256, null);
  assert.match(derived.documents['/display/$goalId'].reason, /2 loads reduce to 2 different canonical documents/);
  assert.equal(bindBuild(derived, EXACT).status, 'FAIL');
  assert.match(bindLines(derived, bindBuild(derived)).join('\n'), /LOVABLE_OBSERVED_DOCUMENT \/display\/\$goalId UNBOUND/);
  // R1 at bind: a leading BOM is kept, so documents that carry one reduce to another digest; one BOM load unbinds.
  const bom = await servedManifest(site({ ...SITE, doc: (p) => `\uFEFF${servedDoc(p)}` }).fetchImpl);
  assert.ok(ROUTE_TEMPLATES.every((t) => bom.documents[t].sha256 && bom.documents[t].sha256 !== DOCS[t].sha256), 'bound, to other digests');
  assert.equal(bindBuild(bom, EXACT).status, 'FAIL');
  const bomLines = bindLines(bom, bindBuild(bom, EXACT));
  assert.deepEqual(bomLines.filter((l) => / bom=/.test(l)).map((l) => / bom=(yes|no)/.exec(l)[1]), Array(ROUTE_TEMPLATES.length + BIND_PROBES.length).fill('yes'), 'and the bind says a BOM leads, for each template and each load');
  assert.deepEqual(JSON.parse(bomLines.at(-1).slice('LOVABLE_OBSERVED_BUILD '.length)).documents['/'], { sha256: bom.documents['/'].sha256, streamU: 2, nul: 2, img: 0 }, 'the line to pin keeps its shape');
  let firstRoot = true;
  const oneBom = await servedManifest(site({ ...SITE, doc: (p) => (p === '/' && firstRoot ? ((firstRoot = false), `\uFEFF${servedDoc(p)}`) : servedDoc(p)) }).fetchImpl);
  assert.equal(oneBom.documents['/'].sha256, null);
  // R7 at bind: a document declared in another charset, or not as HTML, is refused by name, and the template unbinds.
  for (const [type, why] of [['text/html; charset=windows-1252', /served with charset windows-1252, not UTF-8/], ['text/html; charset=utf-16le', /served with charset utf-16le, not UTF-8/], ['application/octet-stream', /not text\/html/]]) {
    const m2 = await servedManifest(site({ ...SITE, docType: (p) => (p === '/' ? type : undefined) }).fetchImpl);
    assert.equal(m2.documents['/'].sha256, null, type);
    assert.match(m2.documents['/'].reason, why, type);
    assert.equal(bindBuild(m2, EXACT).status, 'FAIL', type);
  }
  // Asset charset at bind (LOVABLE-REVIEWED-BUILD-2): an asset declared in another charset is a load the guard would
  // refuse, so the bind fails by name; its digest is still read, and an asset declared UTF-8 in any spelling passes.
  for (const [p, type, kind] of [['/assets/connected-kiosk-BBB.js', 'text/javascript; charset=windows-1252', 'script'], ['/assets/index-CCC.css', 'text/css; CHARSET=windows-1252', 'stylesheet'],
    ['/assets/connected-kiosk-BBB.js', 'text/javascript;\tcharset=windows-1252', 'script'], ['/assets/index-CCC.css', 'text/css;  charset=windows-1252', 'stylesheet'], // W3 F2
    ['/assets/connected-kiosk-BBB.js', 'text/javascript, text/javascript; charset=windows-1252', 'script']]) { // W3 F3: duplicate headers joined
    const m3 = await servedManifest(site({ ...SITE, assetType: (q) => (q === p ? type : undefined) }).fetchImpl);
    assert.deepEqual(m3.refusals, [`${kind} ${LOVABLE_URL}${p} is served with charset windows-1252, not UTF-8`], type);
    assert.deepEqual(m3.assets, OBSERVED, `${type}: its digest is still read`);
    assert.equal(bindBuild(m3, EXACT).status, 'FAIL', type);
    assert.match(bindBuild(m3, EXACT).reason, /1 reference\(s\) the code guard would refuse/, type);
  }
  const utf8Assets = await servedManifest(site({ ...SITE, assetType: (q) => (q.endsWith('.css') ? 'text/css; Charset="UTF-8"' : 'application/javascript; charset=utf-8') }).fetchImpl);
  assert.deepEqual(utf8Assets.refusals, []);
  assert.equal(bindBuild(utf8Assets, EXACT).status, 'PASS');
  // Step C at bind: a screenshot regeneration between two loads of a param template is absorbed. The template line
  // names both files; the line to pin names neither. One link on a param document unbinds its template by name.
  let shotN = 0;
  const regen = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, p === '/' || p.startsWith('/?') ? {} : { shot: (shotN++ % 2) ? SHOT_B : SHOT_A }) }).fetchImpl);
  assert.equal(regen.documents['/display/$goalId'].sha256, DOCS['/display/$goalId'].sha256);
  assert.deepEqual([regen.documents['/display/$goalId'].previewImages, regen.documents['/display/$goalId'].img, regen.documents['/'].img], [[SHOT_A, SHOT_B], 2, 0]);
  assert.equal(bindBuild(regen, EXACT).status, 'PASS', 'a regenerated screenshot still binds');
  const regenLines = bindLines(regen, bindBuild(regen, EXACT));
  assert.ok(regenLines.some((l) => l.startsWith('LOVABLE_OBSERVED_DOCUMENT /display/$goalId ') && l.endsWith(` img=2 bom=no preview-image=${SHOT_A},${SHOT_B}`)), 'the template line names both files');
  assert.doesNotMatch(regenLines.at(-1), new RegExp(`${SHOT_A}|${SHOT_B}`), 'never the line to pin');
  const oneShot = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, p.startsWith('/display/') ? { shotTags: shotTags(SHOT_A).split('><')[0] + '>' } : {}) }).fetchImpl);
  assert.equal(oneShot.documents['/display/$goalId'].sha256, null);
  assert.match(oneShot.documents['/display/$goalId'].reason, /1 hosting preview-image link\(s\), not exactly 2/);
  assert.equal(bindBuild(oneShot, EXACT).status, 'FAIL');
  // R2 at bind: an events tag that loads data: code reduces to another digest, so the bind fails.
  const dataTag = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, { eventsPre: '<script src="data:text/javascript,steal()" ' }) }).fetchImpl);
  assert.notEqual(dataTag.documents['/'].sha256, DOCS['/'].sha256);
  assert.equal(bindBuild(dataTag, EXACT).status, 'FAIL');
  // A per-request value outside the two normalized ones (a nonce in an inline script) unbinds `/` the same way.
  const nonce = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, { body: `<script>n="${crypto.randomBytes(4).toString('hex')}"</script>` }) }).fetchImpl);
  assert.ok(ROUTE_TEMPLATES.every((t) => nonce.documents[t].sha256 === null), 'every template unbound');
  // A document reference the guard would refuse fails the bind even when every digest matches.
  const foreign = site({ ...SITE, doc: (p) => servedDoc(p, { head: '<script src="https://cdn.example.test/tag.js"></script><link rel="stylesheet" href="/other/x.css">' }) });
  const f = await servedManifest(foreign.fetchImpl);
  assert.deepEqual(f.refusals, ['script https://cdn.example.test/tag.js is outside the reviewed build and the permitted API origins', 'stylesheet https://we-stay-fit-foundation-trial.lovable.app/other/x.css is not a reviewed asset']);
  assert.equal(bindBuild(f, { documents: f.documents, assets: f.assets }).status, 'FAIL');
  assert.match(bindBuild(f, { documents: f.documents, assets: f.assets }).reason, /2 reference\(s\) the code guard would refuse/);
});

test('document type (L0 R7): text/html with no charset or UTF-8 only; anything else names why', () => {
  for (const ok of ['text/html', 'text/html; charset=utf-8', 'text/html;charset=UTF-8', 'text/html; charset="utf-8"', 'Text/HTML; charset=utf8']) assert.equal(documentTypeProblem(ok), null, ok);
  for (const [bad, why] of [
    ['text/html; charset=windows-1252', /charset windows-1252, not UTF-8/], ['text/html; CHARSET=windows-1252', /charset windows-1252, not UTF-8/], ['text/html; charset=utf-16le', /charset utf-16le, not UTF-8/], ['text/html; charset=iso-8859-1', /iso-8859-1/],
    ['text/html; charset=utf-8; charset=windows-1252', /charset utf-8, windows-1252, not UTF-8/], ['text/html; charset=', /charset , not UTF-8/],
    ['text/plain', /another content type/], ['application/xhtml+xml', /another content type/], ['text/htmlx', /another content type/], ['', /no content type/], [null, /no content type/], [undefined, /no content type/],
  ]) assert.match(documentTypeProblem(bad), why, String(bad));
});

test('asset type (LOVABLE-REVIEWED-BUILD-2): no charset or UTF-8 only, in any case; anything else names why', () => {
  for (const ok of [undefined, null, '', 'text/javascript', 'text/javascript; charset=utf-8', 'application/javascript;charset="UTF-8"', 'text/css; Charset=utf8', 'TEXT/CSS']) assert.equal(assetTypeProblem(ok), null, String(ok));
  for (const [bad, why] of [
    ['text/javascript; charset=windows-1252', /^served with charset windows-1252, not UTF-8$/], ['text/css; CHARSET=windows-1252', /charset windows-1252, not UTF-8/], ['text/javascript; Charset="utf-16le"', /charset utf-16le, not UTF-8/],
    ['text/css; charset=iso-8859-1', /iso-8859-1/], ['text/javascript; charset=utf-8; charset=windows-1252', /charset utf-8, windows-1252, not UTF-8/], ['text/javascript; charset=', /charset , not UTF-8/],
    ['text/javascript;\tcharset=windows-1252', /charset windows-1252, not UTF-8/], ['text/css;  charset=windows-1252', /charset windows-1252, not UTF-8/], // W3 F2
    ['text/javascript, text/javascript; charset=windows-1252', /charset windows-1252, not UTF-8/], // W3 F3: duplicate headers, joined
  ]) assert.match(assetTypeProblem(bad), why, bad);
});

test('binding: empty or partial reviewed build BLOCKED; exact PASS; a changed document, timestamp count or asset, or a refused reference FAIL', () => {
  // The shipped pin: a canonical document for every template and every asset, frozen; it binds to itself exactly.
  assert.ok(Object.isFrozen(REVIEWED_BUILD) && Object.isFrozen(REVIEWED_BUILD.documents) && Object.isFrozen(REVIEWED_BUILD.assets));
  assert.deepEqual(Object.keys(REVIEWED_BUILD.documents), ROUTE_TEMPLATES);
  for (const t of ROUTE_TEMPLATES) {
    const d = REVIEWED_BUILD.documents[t];
    assert.ok(Object.isFrozen(d) && /^[0-9a-f]{64}$/.test(d.sha256) && d.streamU === 2 && Number.isInteger(d.nul) && d.nul >= 0 && Number.isInteger(d.img) && d.img >= 0, `${t} is pinned`);
    assert.deepEqual(Object.keys(d), ['sha256', 'streamU', 'nul', 'img']);
  }
  assert.ok(Object.keys(REVIEWED_BUILD.assets).length > 0 && Object.entries(REVIEWED_BUILD.assets).every(([n, d]) => /^[A-Za-z0-9_.-]+\.(js|css)$/.test(n) && /^[0-9a-f]{64}$/.test(d)));
  assert.equal(bindBuild({ documents: REVIEWED_BUILD.documents, assets: REVIEWED_BUILD.assets, refusals: [] }).status, 'PASS', 'the shipped pin is a whole reviewed build');
  assert.equal(bindBuild({ documents: DOCS, assets: OBSERVED, refusals: [] }).status, 'FAIL', 'and another build fails it');
  const seen = { documents: { ...DOCS }, assets: { ...OBSERVED }, refusals: [] };
  assert.equal(bindBuild(seen, { documents: {}, assets: {} }).status, 'BLOCKED', 'an empty pin stops every run in the gate');
  assert.equal(bindBuild(seen, { documents: DOCS, assets: {} }).status, 'BLOCKED', 'documents without assets are not a reviewed build');
  assert.equal(bindBuild(seen, { documents: {}, assets: OBSERVED }).status, 'BLOCKED', 'assets without documents are not a reviewed build');
  for (const t of ROUTE_TEMPLATES) {
    const { [t]: _, ...partial } = DOCS;
    assert.equal(bindBuild(seen, { documents: partial, assets: OBSERVED }).status, 'BLOCKED', `no ${t} document`);
    // Each partial pin lacks exactly one field and carries every other, so each check is load-bearing on its own.
    const { img } = DOCS[t];
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { sha256: DOCS[t].sha256, nul: 2, img } }, assets: OBSERVED }).status, 'BLOCKED', `${t} without its u: count`);
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { sha256: DOCS[t].sha256, streamU: 0, nul: 2, img } }, assets: OBSERVED }).status, 'BLOCKED', `${t} with no u:`);
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { sha256: DOCS[t].sha256, streamU: 2, img } }, assets: OBSERVED }).status, 'BLOCKED', `${t} without its NUL count`);
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { sha256: DOCS[t].sha256, streamU: 2, nul: -1, img } }, assets: OBSERVED }).status, 'BLOCKED', `${t} with a negative NUL count`);
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { sha256: DOCS[t].sha256, streamU: 2, nul: 2 } }, assets: OBSERVED }).status, 'BLOCKED', `${t} without its preview-image count (step C)`);
    assert.equal(bindBuild(seen, { documents: { ...DOCS, [t]: { ...DOCS[t], img: -1 } }, assets: OBSERVED }).status, 'BLOCKED', `${t} with a negative preview-image count`);
  }
  assert.equal(bindBuild(seen, EXACT).status, 'PASS');
  assert.match(bindBuild(seen, EXACT).reason, /3 reviewed route documents and 3 reviewed assets served exactly/);
  for (const t of ROUTE_TEMPLATES) {
    assert.equal(bindBuild({ ...seen, documents: { ...DOCS, [t]: { ...DOCS[t], sha256: sha('other') } } }, EXACT).status, 'FAIL', `${t} changed`);
    assert.equal(bindBuild({ ...seen, documents: { ...DOCS, [t]: { ...DOCS[t], streamU: 3 } } }, EXACT).status, 'FAIL', `${t} with another u: count`);
    assert.equal(bindBuild({ ...seen, documents: { ...DOCS, [t]: { ...DOCS[t], nul: 3 } } }, EXACT).status, 'FAIL', `${t} with another NUL count`);
    assert.equal(bindBuild({ ...seen, documents: { ...DOCS, [t]: { ...DOCS[t], img: DOCS[t].img + 1 } } }, EXACT).status, 'FAIL', `${t} with another preview-image count`);
    assert.equal(bindBuild({ ...seen, documents: { ...DOCS, [t]: { sha256: null, streamU: null, reason: 'x' } } }, EXACT).status, 'FAIL', `${t} unbound`);
  }
  assert.equal(bindBuild({ ...seen, assets: { ...OBSERVED, 'shell-AAA.js': sha('changed') } }, EXACT).status, 'FAIL');
  assert.equal(bindBuild({ ...seen, assets: { ...OBSERVED, 'extra-ZZZ.js': sha('x') } }, EXACT).status, 'FAIL');
  const { 'index-CCC.css': _, ...missing } = OBSERVED;
  assert.equal(bindBuild({ ...seen, assets: missing }, EXACT).status, 'FAIL');
  assert.equal(bindBuild({ ...seen, refusals: ['script x'] }, EXACT).status, 'FAIL');
  assert.equal(bindBuild({ documents: seen.documents, assets: seen.assets }, EXACT).status, 'FAIL', 'an observation with no reference check never passes');
  assert.equal(bindBuild(undefined, EXACT).status, 'FAIL');
});

test('bind lines: verdict, documents, probes, refused references, assets and the manifest to pin; never a document or a token', async () => {
  const token = 'tokSECRETvalue.abcDEF123';
  const m = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, { token }) }).fetchImpl);
  const lines = bindLines(m, bindBuild(m));
  assert.match(lines[0], /^LOVABLE_BUILD=FAIL \(the served \/, \/display\/\$goalId, \/kiosk\/\$communityId\/\$goalId documents differ/, 'the fake host is not the pinned build');
  assert.deepEqual(lines.slice(1, 4), ROUTE_TEMPLATES.map((t) => `LOVABLE_OBSERVED_DOCUMENT ${t} ${DOCS[t].sha256} u=2 nul=2 (stream part 1, other inline script 0, markup 1) img=${t === '/' ? 0 : 2} bom=no${t === '/' ? '' : ` preview-image=${SHOT_A}`}`), 'counts and classes of NULs, preview images and whether a BOM leads, never bytes');
  assert.equal(lines.filter((l) => l.startsWith('LOVABLE_DOCUMENT_PROBE ')).length, BIND_PROBES.length);
  assert.ok(lines.includes(`LOVABLE_DOCUMENT_PROBE /display/Zq9wsfBindProbeGoal2 /display/$goalId ${DOCS['/display/$goalId'].sha256} u=2 nul=2 (stream part 1, other inline script 0, markup 1) img=2 bom=no params={"goalId":2}`));
  assert.deepEqual(lines.filter((l) => l.startsWith('LOVABLE_OBSERVED_ASSET ')), Object.entries(OBSERVED).map(([n, d]) => `LOVABLE_OBSERVED_ASSET ${n} ${d}`));
  const last = lines.at(-1);
  assert.ok(last.startsWith('LOVABLE_OBSERVED_BUILD '));
  assert.deepEqual(JSON.parse(last.slice('LOVABLE_OBSERVED_BUILD '.length)), { documents: DOCS, assets: OBSERVED }, 'the line to pin is exactly the observed build');
  assert.doesNotMatch(lines.join('\n'), /tokSECRET|<html|<script|\$_TSR/, 'names, counts and digests only');
  assert.ok(lines.includes(`LOVABLE_DOCUMENT_PROBE / (with an invite query) / ${DOCS['/'].sha256} u=2 nul=2 (stream part 1, other inline script 0, markup 1) img=0 bom=no params={}`));
  assert.doesNotMatch(lines.join('\n'), /\u0000/, 'no NUL byte is ever printed');
  assert.deepEqual(lines.filter((l) => l.startsWith('LOVABLE_DOCUMENT_BLOCKED_HOST_SCRIPT ')), [`LOVABLE_DOCUMENT_BLOCKED_HOST_SCRIPT script ${EVENTS_SCRIPT}`, `LOVABLE_DOCUMENT_BLOCKED_HOST_SCRIPT script ${FLOCK_SCRIPT}`], 'what the bind would block is printed, once each');
  assert.doesNotMatch(lines.join('\n'), /join=|\?/, 'a probe line names the page, never its query');
  // Step C: a screenshot file name is printed only in its checked shape, so a hostile value can't inject a log line.
  const forged = bindLines({ ...m, documents: { ...m.documents, '/display/$goalId': { ...m.documents['/display/$goalId'], previewImages: [SHOT_A, 'x\n::error::injected', `${SHOT_A}"`, SHOT_A.toUpperCase()] } } }, { status: 'FAIL', reason: 'x' });
  assert.ok(forged.find((l) => l.startsWith('LOVABLE_OBSERVED_DOCUMENT /display/$goalId ')).endsWith(` preview-image=${SHOT_A}`));
  assert.doesNotMatch(forged.join('\n'), /::error::|"\s|[A-F]{32}_/, 'nothing else is printed');
  // F7 (W3): a BOM inside a document is no leading BOM.
  const inner = await servedManifest(site({ ...SITE, doc: (p) => servedDoc(p, { body: '\uFEFF' }) }).fetchImpl);
  assert.ok(bindLines(inner, bindBuild(inner)).filter((l) => / bom=/.test(l)).every((l) => / bom=no( |$)/.test(l)));
  const unbound = bindLines({ ...m, documents: { ...m.documents, '/': { sha256: null, streamU: null, reason: 'r' } } }, { status: 'FAIL', reason: 'x' });
  assert.ok(!unbound.some((l) => l.startsWith('LOVABLE_OBSERVED_BUILD ')), 'no manifest to pin while a template is unbound');
  assert.deepEqual(bindLines(null, { status: 'FAIL', reason: 'unreadable' }), ['LOVABLE_BUILD=FAIL (unreadable)']);
});

// ---- receipt, results and verdict ------------------------------------------------------------------
// The connected app's canonical wsfContribute exchange: the request carries goal, attempt and count; the response
// carries only {addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status, crossedTarget}.
const CANON_REQ = { goalId: 'g', attemptId: 'at1', count: 7 };
const CANON_RES = { addedCount: 7, ownCredit: 7, alreadyRecorded: false, sharedTotal: 107, target: 5000, unit: 'squats', status: 'active', crossedTarget: false };
const want = (screenText) => ({ goalId: 'g', amount: 7, unit: 'squats', screenText });

test('receipt (reproducer #365 6045688233): the canonical response is accepted; a replay or the wrong screen total is not', () => {
  const ok = receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want('+7 squats · Together 107 squats'));
  assert.equal(ok.ok, true, ok.seen);
  assert.equal(ok.attemptId, 'at1', 'the attempt comes from the request');
  assert.equal(ok.shared, 107);
  assert.equal(receiptVerdict({ data: CANON_REQ, result: { ...CANON_RES, alreadyRecorded: true } }, want('Together 107 squats')).ok, false, 'replay');
  for (const screen of ['Together 100 squats', 'Together 1,107 squats', 'Together 1070 squats', 'Together 10.7 squats']) {
    assert.equal(receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want(screen)).ok, false, screen);
  }
});

test('receipt: request this goal, count 7 and an attempt; response 7 added, not a replay, integer totals, the goal unit', () => {
  const screen = 'Together 107 squats';
  for (const [name, data, result] of [
    ['6 added', CANON_REQ, { ...CANON_RES, addedCount: 6 }],
    ['another goal', { ...CANON_REQ, goalId: 'h' }, CANON_RES],
    ['count 6 sent', { ...CANON_REQ, count: 6 }, CANON_RES],
    ['no attempt', { ...CANON_REQ, attemptId: undefined }, CANON_RES],
    ['empty attempt', { ...CANON_REQ, attemptId: '' }, CANON_RES],
    ['alreadyRecorded missing', CANON_REQ, { ...CANON_RES, alreadyRecorded: undefined }],
    ['other unit', CANON_REQ, { ...CANON_RES, unit: 'reps' }],
    ['fractional total', CANON_REQ, { ...CANON_RES, sharedTotal: 107.5 }],
    ['no own credit', CANON_REQ, { ...CANON_RES, ownCredit: undefined }],
    ['no result', CANON_REQ, null],
    ['no request', null, CANON_RES],
  ]) assert.equal(receiptVerdict({ data, result }, want(screen)).ok, false, name);
  assert.equal(receiptVerdict(null, want(screen)).ok, false, 'no exchange');
  assert.equal(receiptVerdict({ data: CANON_REQ, result: CANON_RES }, want('Together 107 reps')).ok, false, 'screen without the unit');
});

test('showsNumber: the exact whole number, en-US grouped or plain, never a fragment of another number', () => {
  assert.equal(showsNumber('Together 1,107 squats', 1107), true);
  assert.equal(showsNumber('Together 1107 squats', 1107), true);
  for (const [t, n] of [['11,107', 1107], ['1,1070', 1107], ['1107.5', 1107], ['107', 1107], ['x', 1.5]]) assert.equal(showsNumber(t, n), false, t);
});

test('results: every row in order; the station rows and the unverified account are BLOCKED by name unless measured', () => {
  const doc = results({ 'host-build': { status: 'PASS', seen: 'x' } });
  assert.deepEqual(doc.rows.map((r) => r.id), ROWS.map((r) => r.id));
  for (const id of Object.keys(FIXED_BLOCKED)) assert.equal(doc.rows.find((r) => r.id === id).status, 'BLOCKED', id);
  assert.match(doc.rows.find((r) => r.id === 'round-60s').seen, /#587/);
  assert.equal(doc.rows.find((r) => r.id === 'qr-join').seen, 'not reached');
  assert.equal(allPassed(doc), false);
  assert.equal(allPassed(results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])))), true);
  assert.doesNotMatch(JSON.stringify(results({ 'qr-join': { status: 'FAIL', seen: 'sign in as wsf-e5c-x-lka-ab12@example.com?token=abc' } })), /@example\.com|token=abc/, 'emails and query values are scrubbed');
});

test('require: PASS only on every row PASS, cleanup success and scan success; BLOCKED and FAIL are named', () => {
  const all = results(Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }])));
  assert.equal(requireVerdict(all, { cleanup: 'success', scan: 'success' }).ok, true);
  for (const o of [{ cleanup: 'failure', scan: 'success' }, { cleanup: 'success', scan: 'failure' }, { cleanup: 'skipped', scan: 'success' }, {}]) assert.equal(requireVerdict(all, o).ok, false, JSON.stringify(o));
  const blocked = requireVerdict(results({ 'host-build': { status: 'PASS' } }), { cleanup: 'success', scan: 'success' });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.lines.includes('LOVABLE_KIOSK_PROOF=BLOCKED'));
  assert.ok(requireVerdict(results({ 'qr-join': { status: 'FAIL' } }), { cleanup: 'success', scan: 'success' }).lines.includes('LOVABLE_KIOSK_PROOF=FAIL'));
  assert.ok(requireVerdict(null, { cleanup: 'success', scan: 'success' }).lines.includes('LOVABLE_KIOSK_PROOF=FAIL'), 'no results is a failure');
});

test('cleanup merge: run-tagged product documents are added once; anything untagged refuses the whole merge', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-lk-')), 'm.json');
  fs.writeFileSync(file, JSON.stringify({ project: 'westayfit-staging', runTag: 'e5c-t-1', users: ['u'], docs: ['wsfGoals/e5cgoal-e5c-t-1-lk'], linkedDocs: [] }));
  assert.equal(mergeIntoManifest(file, ['wsfMemberships/e5cgrp-e5c-t-1-lk_uidA', 'wsfMemberships/e5cgrp-e5c-t-1-lk_uidA']), 2);
  for (const bad of [['wsfMemberships/realgroup_uidA'], ['../e5c-t-1/x'], ['/wsfMemberships/e5c-t-1']]) {
    assert.throws(() => mergeIntoManifest(file, bad), /untagged/);
  }
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).docs.length, 2, 'a refused merge writes nothing');
  assert.equal(idHash('uid-1'), sha('uid-1').slice(0, 16));
  assert.equal(idHash(''), null);
});

// ---- the journey against a scripted Lovable UI ------------------------------------------------------
/**
 * A fake of the connected Lovable app and its backend, built from the app's own source (connected-kiosk, join, move,
 * together, progress, menu). One server; each context has its own storage. Every callable is a request object with
 * its OWN response, delivered to the page's listeners in that order. `bug` switches on one defect at a time.
 */
/** The served build the fake host serves, and its reviewed manifest (what a pinned REVIEWED_BUILD would hold). */
const FAKE_ASSETS = { '/assets/shell-AAA.js': 'export const shell=1;', '/assets/kiosk-BBB.js': 'export const kiosk=1;', '/assets/index-CCC.css': 'body{}' };
const FAKE_REVIEWED = Object.freeze({ documents: DOCS, assets: Object.freeze(Object.fromEntries(Object.entries(FAKE_ASSETS).map(([p, b]) => [p.slice(8), sha(b)]))) });
const EVENTS_SCRIPT = `${LOVABLE_URL}/__l5e/events.a1b2c3d4e5f60718.js`;
const FLOCK_SCRIPT = `${LOVABLE_URL}/~flock.js`;

/** The kit's verified member of the event community (the phone control), and the member's other goal, read alongside. */
const CONTROL_UID = 'uid-lk-a0';
const OTHER_GOAL = 'e5cgoal-other-community';

function lovable(bug = {}) {
  const goalId = 'e5cgoal-e5c-t-1-lk';
  const groupId = 'e5cgrp-e5c-t-1-lk';
  const server = { shared: 100, own: {}, members: new Set(), contributions: 0, approved: false, requests: [], contextOpts: [], routed: 0, docs: 0, loads: [], passwordFills: 0 };
  const accounts = {};
  let ctxCount = 0;
  /** What the host answers for one URL. Drift, a different deep link, a redirect and a changed chunk are switchable. */
  const serve = (url) => {
    const u = new URL(url);
    if (u.origin !== LOVABLE_URL) return { status: 200, body: 'globalThis.foreign = 1;' };
    if (u.pathname.startsWith('/assets/')) {
      if (!Object.hasOwn(FAKE_ASSETS, u.pathname)) return { status: bug.extraChunk && u.pathname === '/assets/extra-ZZZ.js' ? 200 : 404, body: 'export const extra=1;' };
      return { status: 200, body: bug.changedChunk && u.pathname === '/assets/kiosk-BBB.js' ? 'export const kiosk=2;' : FAKE_ASSETS[u.pathname] };
    }
    server.docs += 1;
    if (bug.redirectDoc) return { status: 302, body: '' };
    if (bug.deepLinkDiffers && u.pathname.startsWith('/kiosk/')) return { status: 200, body: servedDoc(u.pathname, { body: '<script>inline()</script>' }) };
    if (bug.driftAfter && server.docs > bug.driftAfter) return { status: 200, body: servedDoc(u.pathname, { body: '<!-- republished -->' }) };
    return { status: 200, body: servedDoc(u.pathname) };
  };
  /** One browser request through the context's route handler, as Playwright delivers it; resolves to what the handler did. */
  async function load(context, url, type, navigation) {
    let outcome = 'unhandled';
    const route = {
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation }),
      async fetch(o) {
        assert.equal(o?.maxRedirects, 0, 'a verified response never follows a redirect');
        const r = serve(url);
        const ct = new URL(url).pathname.startsWith('/assets/') ? 'text/javascript' : 'text/html; charset=utf-8';
        return { status: () => r.status, headers: () => ({ 'content-type': ct, 'x-served': 'lovable' }), body: async () => Buffer.from(r.body) };
      },
      async fulfill({ body, headers }) { outcome = 'fulfilled'; server.loads.push({ url, type, body: String(body), contentType: headers?.['content-type'] ?? null, kept: headers?.['x-served'] ?? null }); },
      async continue() { outcome = 'continued'; },
      async abort() { outcome = 'aborted'; },
    };
    assert.equal(context.handlers.length, 1, 'every context routes every request through the guard');
    server.routed += 1;
    await context.handlers[0](route);
    return outcome;
  }
  /** A page load: the document, then what it loads (the kiosk chunk on the kiosk route), plus any injected defect. */
  async function pageLoad(context, url) {
    if ((await load(context, url, 'document', true)) !== 'fulfilled') throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${new URL(url).origin}${new URL(url).pathname}`);
    const subs = [[EVENTS_SCRIPT, 'script'], [FLOCK_SCRIPT, 'script'], [`${LOVABLE_URL}/assets/shell-AAA.js`, 'script'], [`${LOVABLE_URL}/assets/index-CCC.css`, 'stylesheet'], [`${LOVABLE_URL}/favicon.ico`, 'image']];
    if (new URL(url).pathname.startsWith('/kiosk/')) subs.push([`${LOVABLE_URL}/assets/kiosk-BBB.js`, 'script']);
    if (bug.foreignScript) subs.push(['https://cdn.example.test/x.js', 'script']);
    if (bug.foreignOnJoin && new URL(url).searchParams.has('join')) subs.push(['https://cdn.example.test/join.js', 'script']);
    if (bug.foreignOnHome && new URL(url).pathname === '/' && !new URL(url).searchParams.has('join')) subs.push(['https://cdn.example.test/home.js', 'script']);
    if (bug.extraChunk) subs.push([`${LOVABLE_URL}/assets/extra-ZZZ.js`, 'script']);
    for (const [s, t] of subs) await load(context, s, t, false);
  }
  const browser = {
    async newContext(opts) {
      ctxCount += 1;
      server.contextOpts.push(opts);
      const store = { local: {}, session: {}, idbUid: null };
      let closed = false;
      const context = {
        handlers: [],
        async route(pattern, handler) { assert.equal(pattern, '**/*'); context.handlers.push(handler); },
        async newPage() { return page(store, context); },
        async close() { closed = true; browser.closed += 1; },
        get closed() { return closed; },
      };
      return context;
    },
    closed: 0,
  };
  function page(store, context) {
    let current = null;
    let view = 'blank';
    let move = null; // null | 'camera' | 'count' | 'review' | 'receipt'
    let attempt = null;
    let typed = 0;
    let email = '';
    let lastReceipt = null;
    const listeners = { request: [], response: [] };
    const uid = () => store.idbUid;
    const send = (name, data) => {
      const req = { url: () => `https://us-central1-westayfit-staging.cloudfunctions.net/${name}`, method: () => 'POST', postData: () => JSON.stringify({ data }) };
      server.requests.push({ name, data, uid: uid() });
      for (const f of listeners.request) f(req);
      return req;
    };
    const answer = (req, result) => { const res = { request: () => req, json: async () => ({ result }) }; for (const f of listeners.response) f(res); };
    const call = (name, data, result) => answer(send(name, data), result);
    /** Several same-name callables in flight at once (Home reads every community's goal): all requests, then the responses in REVERSE order. */
    const interleaved = (calls) => { const sent = calls.map(([name, data, result]) => [send(name, data), result]); for (const [req, result] of sent.reverse()) answer(req, result); };
    const hydrate = () => {
      if (!uid()) return;
      const chosen = store.local[`wsf.currentCommunity.${uid()}`] ?? store.local[`wsf.pinnedDestination.${uid()}`];
      if (server.members.has(uid()) && chosen === groupId) {
        const drift = bug.aOwnOnReturn && uid() === CONTROL_UID && server.aSignIns >= 2 ? bug.aOwnOnReturn : 0;
        // The member's other community's goal is read in the same burst; its answers arrive around the test goal's.
        interleaved([
          ['wsfMyContribution', { goalId: OTHER_GOAL }, { ownCredit: 999, unit: 'squats', repeatPolicy: 'multiple' }],
          ['wsfMyContribution', { goalId }, { ownCredit: (server.own[uid()] ?? 0) + drift, unit: 'squats', repeatPolicy: 'multiple' }],
          ['wsfGoalPulse', { goalId: OTHER_GOAL }, { sharedTotal: 99_999, target: 5000, unit: 'squats', status: 'active' }],
          ['wsfGoalPulse', { goalId }, { sharedTotal: server.shared + (bug.pulseDrift ?? 0), target: 1000, unit: 'squats', status: 'active' }],
        ]);
      }
      if (bug.bReadsA && uid() === 'uid-lkb') call('wsfMyContribution', { goalId }, { ownCredit: 7, unit: 'squats', repeatPolicy: 'multiple' });
    };
    const fmt = (n) => n.toLocaleString('en-US');
    const progressText = () => {
      const show = (uid() && server.members.has(uid()) && (server.own[uid()] ?? 0) > 0) || (bug.bSeesRow && uid() === 'uid-lkb');
      return show ? `Fixture Expo Squats Yours ${fmt(server.own[CONTROL_UID] ?? 0)} squats Shared ${fmt(bug.rowTotal ?? server.shared + (bug.pulseDrift ?? 0))} / 1,000 squats` : null;
    };
    const el = (key, scope = null) => {
      const self = {
        first() { return self; },
        filter() { return self; },
        getByRole: (_, o) => el(`role:${o.name instanceof RegExp ? 'community' : o.name}`, key),
        async waitFor() { if (!(await self.count())) throw new Error(`${key} never appeared`); },
        async count() {
          switch (key) {
            case 'testid:kiosk-pair-code': return view === 'kiosk' ? 1 : 0;
            // The kit's community is private: the served kiosk shows no join code unless a link-joinable community is faked.
            case 'css:svg[data-testid="kiosk-qr"]': return view === 'kiosk' && server.approved && bug.linkJoinable ? 1 : 0;
            case 'text:This goal has no join code to show.': return view === 'kiosk' && server.approved && !bug.linkJoinable ? 1 : 0;
            case 'css:[data-connected-join]': case 'role:Join': return uid() && store.session['wsf.pendingJoinCode'] && !bug.noJoinButton ? 1 : 0;
            case 'testid:join-move-phone': return view === 'choose' ? 1 : 0;
            case 'css:section.together-receipt': return move === 'receipt' ? 1 : 0;
            case 'css:ul.goal-history li': return progressText() ? 1 : 0;
            case 'role:Skip tour': return 0;
            case 'role:Count by hand instead': return move === 'camera' ? 1 : 0;
            case 'role:Enter reps manually': case 'role:I’m done — enter my count': return 0;
            case 'nav:Your communities': return uid() && !store.local[`wsf.currentCommunity.${uid()}`] ? 1 : 0;
            default: return 1;
          }
        },
        async innerText() {
          if (key === 'testid:kiosk-pair-code') return 'ABC234';
          if (key === 'css:section.together-receipt') return lastReceipt;
          if (key === 'css:ul.goal-history li') return progressText();
          return '';
        },
        async getAttribute(name) {
          if (name === 'data-join-url') return `${bug.qrOrigin ?? LOVABLE_URL}/?join=JOINCODE0123456789&goal=${goalId}`;
          if (name === 'data-attempt') return bug.otherAttempt ? 'attempt-other0000' : attempt;
          return null;
        },
        async fill(v) {
          if (key === 'label:Email') email = v;
          else if (key === 'label:Password') { server.passwordFills += 1; if (accounts[email]?.password !== v) throw new Error('wrong password'); }
          else typed = Number(v);
        },
        async click() {
          if (key === 'role:Sign in') {
            const control = accounts[email]?.uid === CONTROL_UID;
            store.idbUid = bug.aReturnsAs && control && server.signedA ? bug.aReturnsAs : accounts[email].uid;
            if (bug.controlSignInFails && control) store.idbUid = null; // the sign-in silently did not complete
            if (control) { server.signedA = true; server.aSignIns = (server.aSignIns ?? 0) + 1; }
            if (store.idbUid === bug.aReturnsAs) { server.own[bug.aReturnsAs] = server.own[CONTROL_UID]; server.members.add(bug.aReturnsAs); }
            hydrate();
          }
          else if (key === 'role:Join') {
            const already = server.members.has(uid());
            server.members.add(uid());
            call('wsfJoinCommunity', { joinCode: store.session['wsf.pendingJoinCode'] }, { groupId: bug.otherGroup ? 'other-group' : groupId, alreadyMember: bug.alreadyMember ?? already });
            view = 'choose';
          } else if (key === 'testid:join-move-phone') {
            store.local[`wsf.pinnedDestination.${uid()}`] = groupId; delete store.session['wsf.pendingJoinCode']; delete store.session['wsf.pendingJoinGoal'];
            view = 'home'; hydrate(); move = 'camera'; attempt = `attempt-${server.contributions + 1}abcdefgh`;
          } else if (key === 'role:Count by hand instead') move = 'count';
          else if (key === 'role:Review') move = 'review';
          else if (key === 'testid:confirm') {
            server.contributions += 1;
            const added = bug.addedCount ?? typed;
            server.shared += added; server.own[uid()] = (server.own[uid()] ?? 0) + added;
            call('wsfContribute', { goalId: bug.otherGoal ? 'e5cgoal-other' : goalId, attemptId: attempt, count: typed },
              { addedCount: added, ownCredit: bug.receiptOwn ?? server.own[uid()], alreadyRecorded: !!bug.alreadyRecorded, sharedTotal: server.shared, target: 1000, unit: bug.unit ?? 'squats', status: 'active', crossedTarget: false });
            if (bug.doubleSend) call('wsfContribute', { goalId, attemptId: attempt, count: typed }, { addedCount: 0, ownCredit: server.own[uid()], alreadyRecorded: true, sharedTotal: server.shared, target: 1000, unit: 'squats', status: 'active', crossedTarget: false });
            if (bug.pendingLeft) store.local[`wsf.pendingContribution.${goalId}.${uid()}`] = '{}';
            move = 'receipt';
            lastReceipt = `YOU ADDED +${fmt(added)} squats ${fmt(bug.screenTotal ?? server.shared)} / 1,000 · shared total from the server`;
          } else if (key === 'testid:together-done') move = null;
          else if (key === 'role:MOVE — add a contribution') {
            const reopened = server.contributions > 0;
            if (bug.lateForeignScript) await load(context, 'https://cdn.example.test/late.js', 'script', false);
            move = bug.replayReceipt && reopened ? 'receipt' : 'camera'; attempt = `attempt-${server.contributions + 1}abcdefgh`;
            if (bug.resendOnReopen && reopened) call('wsfContribute', { goalId, attemptId: attempt, count: typed }, { addedCount: typed, ownCredit: server.own[uid()], alreadyRecorded: true, sharedTotal: server.shared, unit: 'squats' });
          } else if (key === 'role:Open menu') { /* opens the sheet */ }
          else if (key === 'role:/^Sign out/' || key === 'role:Sign out') { store.idbUid = null; }
          else if (key === 'role:community' && scope === 'nav:Your communities') { store.local[`wsf.currentCommunity.${uid()}`] = groupId; hydrate(); }
        },
      };
      return self;
    };
    return {
      on(type, f) { listeners[type]?.push(f); },
      async goto(u) {
        const url = new URL(u, LOVABLE_URL);
        await pageLoad(context, url.href);
        current = url.href;
        if (url.pathname.startsWith('/kiosk/')) { view = 'kiosk'; return; }
        if (url.searchParams.get('join')) { store.session['wsf.pendingJoinCode'] = url.searchParams.get('join'); store.session['wsf.pendingJoinGoal'] = url.searchParams.get('goal'); }
        view = 'home'; move = null; hydrate();
      },
      async reload() { await pageLoad(context, current); move = null; hydrate(); },
      async waitForTimeout() {},
      async evaluate(fn, arg) {
        const src = String(fn);
        if (src.includes('firebaseLocalStorageDb')) return uid();
        if (src.includes('sessionStorage')) return ['wsf.pendingJoinCode', 'wsf.pendingJoinGoal'].filter((k) => store.session[k] !== undefined).length;
        if (src.includes('localStorage.getItem')) return store.local[arg] ?? null;
        throw new Error('unexpected evaluate');
      },
      keyboard: { async press() { move = null; } },
      getByTestId: (id) => el(`testid:${id}`),
      getByRole: (role, o) => el(role === 'navigation' ? `nav:${o.name}` : `role:${o.name instanceof RegExp ? o.name.toString() : o.name}`),
      getByLabel: (l) => el(`label:${l}`),
      getByText: (t) => el(`text:${t}`),
      locator: (css) => el(`css:${css}`),
    };
  }
  const tracked = { contributions: [], approvals: 0 };
  const fixtures = {
    async expoEvent(label, opts) {
      assert.deepEqual(opts, { attendees: 1, target: 1000, seeded: 100 }, 'one verified member for the control, made by the kit');
      const m = { uid: CONTROL_UID, email: 'wsf-e5c-t-1-lk-a0-ab12@example.com', password: 'pw-lk-a0' };
      accounts[m.email] = m;
      server.members.add(m.uid);
      return { setupId: `${label}: one synthetic community, one open squats goal, a Champion and 1 attendee`, groupId, goalId, attendees: [m] };
    },
    async memberInTwoCommunities(label) { const m = { uid: `uid-${label}`, email: `wsf-e5c-t-1-${label}@example.com`, password: `pw-${label}` }; accounts[m.email] = m; return { member: m }; },
    async approveStation(ev, code, slot) { assert.equal(code, 'ABC234'); assert.equal(slot, 1); server.approved = !bug.approvalLost; tracked.approvals += 1; return { stationId: 's1', slot }; },
    trackContribution(ev, member, attemptId) { tracked.contributions.push([member.uid, attemptId]); },
  };
  return { browser, fixtures, server, tracked, opened: () => ctxCount };
}
const statusOf = (rows, id) => rows[id]?.status;
/** The rows the existing kit can reach: the phone rows are the verified-member control's. */
const PHONE_ROWS = ['contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation'];
const PASSING = ['fixture-provenance', ...PHONE_ROWS];

test('journey with the kit\'s real shape (#589 W4 F1): qr-join BLOCKED by name for the private community; the verified-member control records 7 once, re-reads, reopens static, and control -> B -> control stays isolated', async () => {
  const L = lovable();
  const { rows, productDocs, served } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.deepEqual(served.violations, [], 'the browser loaded only the reviewed build');
  assert.equal(hostBuildRow({ status: 'PASS', reason: 'bind' }, served).status, 'PASS');
  assert.equal(served.verified, L.server.loads.length);
  const reviewedAssets = new Set(Object.values(FAKE_REVIEWED.assets));
  const reviewedDoc = (x) => canonicalDocument(x.body, x.url).sha256 === FAKE_REVIEWED.documents[matchTemplate(new URL(x.url).pathname).template].sha256;
  assert.ok(L.server.loads.length >= 10 && L.server.loads.every((x) => (x.type === 'document' ? reviewedDoc(x) : reviewedAssets.has(sha(x.body)))), 'every executed document reduces to its reviewed template, and every asset is fulfilled with exactly the reviewed bytes');
  assert.ok(L.server.loads.some((x) => x.type === 'document' && new URL(x.url).pathname.startsWith('/kiosk/')) && L.server.loads.some((x) => x.type === 'document' && new URL(x.url).pathname === '/'), 'both templates the kiosk proof loads were verified');
  assert.ok(served.blocked.length > 0 && served.blocked.every((w) => w === `script ${EVENTS_SCRIPT}` || w === `script ${FLOCK_SCRIPT}`), 'the host\'s own scripts are blocked on every page, never run');
  assert.equal(served.blocked.filter((w) => w === `script ${FLOCK_SCRIPT}`).length, served.blocked.filter((w) => w === `script ${EVENTS_SCRIPT}`).length);
  assert.ok(!L.server.loads.some((x) => x.url === EVENTS_SCRIPT || x.url === FLOCK_SCRIPT), 'and never fulfilled');
  assert.ok(L.server.loads.filter((x) => x.type === 'document').every((x) => x.contentType === 'text/html; charset=utf-8' && x.kept === 'lovable'), 'every document is fulfilled as UTF-8 HTML, its other headers kept');
  assert.ok(L.server.loads.filter((x) => x.type !== 'document').every((x) => x.contentType === null), 'an asset keeps its own response headers');
  assert.ok(L.server.contextOpts.length === L.opened() && L.server.contextOpts.every((o) => o.serviceWorkers === 'block'), 'no service worker can answer around the guard');
  assert.equal(statusOf(rows, 'qr-join'), 'BLOCKED');
  assert.match(rows['qr-join'].seen, /only private communities \(joinPolicy private\).*no newcomer QR/);
  for (const id of PASSING) assert.equal(statusOf(rows, id), 'PASS', `${id}: ${rows[id]?.seen}`);
  for (const id of PHONE_ROWS) assert.match(rows[id].seen, /^control \(the kit's verified member\)/, `${id} names who measured it`);
  assert.equal(L.tracked.approvals, 1, 'the kiosk is approved as fixture preparation');
  assert.equal(L.server.contributions, 1, 'exactly one contribution');
  assert.deepEqual(L.tracked.contributions, [[CONTROL_UID, 'attempt-1abcdefgh']], 'the attempt is tracked from its request');
  assert.deepEqual(productDocs, [], 'no join happened, so no membership is product-written');
  assert.ok(L.server.requests.some((x) => x.data?.goalId === OTHER_GOAL), 'the other goal\'s reads were in flight, interleaved');
  assert.equal(L.browser.closed, L.opened(), 'every context is closed');
  for (const id of Object.keys(FIXED_BLOCKED)) assert.equal(rows[id], undefined, `${id} is never measured by the journey`);
  assert.doesNotMatch(JSON.stringify(results(rows)), /pw-lk|@example\.com|uid-lk|JOINCODE/, 'no password, email, raw uid or join code in the results');
});

test('journey with a link-joinable community: A joins through the QR (membership tracked), and the phone rows are still the control\'s', async () => {
  const L = lovable({ linkJoinable: true });
  const { rows, productDocs } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  for (const id of ['qr-join', ...PASSING]) assert.equal(statusOf(rows, id), 'PASS', `${id}: ${rows[id]?.seen}`);
  assert.deepEqual(productDocs, ['wsfMemberships/e5cgrp-e5c-t-1-lk_uid-lka'], 'the join\'s membership is tracked from its request');
  assert.deepEqual(L.tracked.contributions, [[CONTROL_UID, 'attempt-1abcdefgh']]);
  assert.equal(L.browser.closed, L.opened());
});

test('journey negatives: each defect fails exactly the row that measures it; a failed QR join never erases the phone control', async () => {
  const cases = [
    [{ addedCount: 6 }, 'operation-receipt'], [{ alreadyRecorded: true }, 'operation-receipt'], [{ screenTotal: 7 }, 'operation-receipt'],
    [{ unit: 'reps' }, 'operation-receipt'], [{ otherAttempt: true }, 'contribution-7'], [{ otherGoal: true }, 'contribution-7'],
    [{ rowTotal: 1 }, 'own-history-shared'], [{ replayReceipt: true }, 'reopen-static'], [{ resendOnReopen: true }, 'reopen-static'],
    [{ pendingLeft: true }, 'reopen-static'], [{ bReadsA: true }, 'account-isolation'], [{ bSeesRow: true }, 'account-isolation'],
    [{ aReturnsAs: 'uid-someone-else' }, 'account-isolation'], [{ linkJoinable: true, otherGroup: true }, 'qr-join'], [{ linkJoinable: true, noJoinButton: true }, 'qr-join'],
    [{ linkJoinable: true, qrOrigin: 'https://evil.example.test' }, 'qr-join'], [{ linkJoinable: true, alreadyMember: true }, 'qr-join'], [{ doubleSend: true }, 'contribution-7'],
    [{ receiptOwn: 8 }, 'own-history-shared'], [{ pulseDrift: 5 }, 'own-history-shared'], [{ aOwnOnReturn: 3 }, 'account-isolation'],
    [{ controlSignInFails: true }, 'contribution-7'],
  ];
  for (const [bug, row] of cases) {
    const L = lovable(bug);
    const { rows } = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
    assert.equal(statusOf(rows, row), 'FAIL', `${JSON.stringify(bug)} must fail ${row}: ${rows[row]?.seen}`);
    if (bug.qrOrigin) assert.match(rows['qr-join'].seen, /the QR carries no same-host join link/, 'refused by the QR check itself, before any navigation');
    if (bug.controlSignInFails) for (const id of PHONE_ROWS) assert.match(rows[id].seen, /the control member's sign-in did not complete/, `${id}: nothing is measured as an unknown identity`);
    if (row === 'qr-join') for (const id of PHONE_ROWS) assert.equal(statusOf(rows, id), 'PASS', `${JSON.stringify(bug)}: the control's ${id} still stands`);
    assert.equal(L.browser.closed, L.opened(), `${JSON.stringify(bug)}: every context is closed`);
  }
});

test('journey: a contribution whose assertions fail is still tracked for cleanup; a lost approval fails qr-join but not the control', async () => {
  let L = lovable({ addedCount: 6 });
  let r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.equal(statusOf(r.rows, 'operation-receipt'), 'FAIL');
  assert.equal(L.tracked.contributions.length, 1, 'tracked though the receipt failed');
  L = lovable({ approvalLost: true });
  r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.equal(statusOf(r.rows, 'qr-join'), 'FAIL');
  assert.match(r.rows['qr-join'].seen, /did not reach a QR join link/);
  for (const id of PHONE_ROWS) assert.equal(statusOf(r.rows, id), 'PASS', id);
  assert.deepEqual(r.productDocs, []);
  assert.equal(L.browser.closed, L.opened(), 'every context is closed');
});

test('callableLog (#589 W4 F3): same-name callables for different goals, answered in reverse order, each pair with their OWN request', async () => {
  const listeners = { request: [], response: [] };
  const page = { on(t, f) { listeners[t].push(f); } };
  const seen = [];
  const log = callableLog(page, (e) => seen.push([e.data?.goalId, e.result?.addedCount ?? e.result?.ownCredit]));
  const req = (name, data) => ({ url: () => `https://us-central1-westayfit-staging.cloudfunctions.net/${name}`, method: () => 'POST', postData: () => JSON.stringify({ data }) });
  const sent = [['wsfContribute', { goalId: 'g', attemptId: 'ag', count: 7 }, { addedCount: 7 }], ['wsfContribute', { goalId: 'h', attemptId: 'ah', count: 3 }, { addedCount: 3 }],
    ['wsfMyContribution', { goalId: 'g' }, { ownCredit: 7 }], ['wsfMyContribution', { goalId: 'h' }, { ownCredit: 999 }]].map(([n, d, result]) => { const q = req(n, d); for (const f of listeners.request) f(q); return [q, result]; });
  for (const [q, result] of [...sent].reverse()) for (const f of listeners.response) await f({ request: () => q, json: async () => ({ result }) });
  assert.equal(log.last('wsfContribute', 'g').result.addedCount, 7, 'the receipt exchange is the test goal\'s own');
  assert.equal(log.last('wsfContribute', 'h').result.addedCount, 3);
  assert.equal(ownCreditOf(log.last('wsfMyContribution', 'g'), 'g'), 7);
  assert.equal(ownCreditOf(log.last('wsfMyContribution', 'h'), 'h'), 999);
  assert.deepEqual(seen, [['h', 999], ['g', 7], ['h', 3], ['g', 7]], 'each exchange is reported once, with its own response');
  assert.equal(log.sent('wsfContribute'), 2);
  assert.equal(log.sent('wsfContribute', 'g'), 1);
});

test('cli (#589 W4 F2): --bind exits non-zero before any credential unless the served build is exactly the reviewed one; --run refuses a non-PASS bind before the kit or a browser', async () => {
  const env = { WSF_LOVABLE_URL: LOVABLE_URL, WSF_PROJECT: 'westayfit-staging' };
  const exact = EXACT;
  const run = async (mode, e, deps) => { const lines = []; const code = await cli(mode, e, { say: (l) => lines.push(l), ...deps }); return { code, lines }; };
  let r = await run('--bind', env, { fetchImpl: site(SITE).fetchImpl, reviewed: exact });
  assert.equal(r.code, 0, 'an exact match exits zero');
  assert.match(r.lines[0], /^LOVABLE_BUILD=PASS/);
  for (const [name, files, reviewed, e, fetches] of [
    ['the shipped REVIEWED_BUILD (the real pin) against the fake host', SITE, undefined, env, true],
    ['a drifted entry page', { ...SITE, doc: (p) => servedDoc(p, p === '/' ? { body: '<!-- republished -->' } : {}) }, exact, env, true],
    ['a drifted kiosk deep link', { ...SITE, doc: (p) => servedDoc(p, p.startsWith('/kiosk/') ? { status: 'pending' } : {}) }, exact, env, true],
    ['a deep link carrying route data beyond its params', { ...SITE, doc: (p) => servedDoc(p, p.startsWith('/display/') ? { body: `<p>${p.length}</p>` } : {}) }, exact, env, true],
    ['a drifted asset', { ...SITE, assets: { ...SITE.assets, '/assets/shell-AAA.js': `${SITE.assets['/assets/shell-AAA.js']};` } }, exact, env, true],
    ['an unreadable asset (HTTP 404)', { ...SITE, assets: { ...SITE.assets, '/assets/connected-kiosk-BBB.js': undefined } }, exact, env, true],
    ['an unreadable deep link (HTTP 404)', { ...SITE, doc: (p) => (p.startsWith('/kiosk/') ? undefined : servedDoc(p)) }, exact, env, true],
    ['a wrong host', SITE, exact, { ...env, WSF_LOVABLE_URL: 'https://evil.example.test' }, false],
    ['a wrong project', SITE, exact, { ...env, WSF_PROJECT: 'westayfit-prod' }, false],
  ]) {
    const s = site(files);
    r = await run('--bind', e, { fetchImpl: s.fetchImpl, ...(reviewed ? { reviewed } : {}) });
    assert.equal(r.code, 1, name);
    assert.match(r.lines[0], /^LOVABLE_BUILD=(BLOCKED|FAIL)/, name);
    assert.equal(s.calls.length > 0, fetches, `${name}: ${fetches ? 'read' : 'refused before any read'}`);
  }
  r = await run('--bind', env, { fetchImpl: async () => { throw new TypeError('fetch failed'); }, reviewed: exact });
  assert.equal(r.code, 1, 'an unreadable host');
  assert.match(r.lines[0], /^LOVABLE_BUILD=FAIL \(the served build could not be read/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-lk-cli-'));
  let imported = 0;
  let launched = 0;
  const importKit = async () => { imported += 1; return { createFixtureKit: () => { throw new Error('no fixture inputs in this test'); } }; };
  const launch = async () => { launched += 1; throw new Error('no browser in this test'); };
  for (const [name, files, reviewed] of [['the shipped REVIEWED_BUILD (the real pin) against the fake host', SITE, undefined], ['a drifted entry page', { ...SITE, doc: (p) => `${servedDoc(p)} ` }, exact]]) {
    r = await run('--run', { ...env, WSF_RESULT_DIR: dir }, { fetchImpl: site(files).fetchImpl, ...(reviewed ? { reviewed } : {}), importKit, launch });
    assert.equal(r.code, 1, name);
    assert.equal(imported, 0, `${name}: the kit is never imported`);
    assert.equal(launched, 0, `${name}: no browser is launched`);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'lovable-kiosk', 'results.json'), 'utf8'));
    assert.notEqual(doc.rows.find((x) => x.id === 'host-build').status, 'PASS', name);
    assert.ok(doc.rows.every((x) => x.status !== 'PASS'), `${name}: nothing passes`);
  }
  // With an exact bind, --run goes on to the kit (here it stops at the missing fixture inputs): bind first, then the kit.
  r = await run('--run', { ...env, WSF_RESULT_DIR: dir }, { fetchImpl: site(SITE).fetchImpl, reviewed: exact, importKit, launch });
  assert.equal(r.code, 1);
  assert.equal(imported, 1, 'reached only after an exact bind');
  assert.equal(launched, 0);
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'lovable-kiosk', 'results.json'), 'utf8')).rows.find((x) => x.id === 'fixture-provenance').seen, /fixture inputs are missing/);
});

// ---- the served-code guard (#589 W9 finding #497 6051520120): bind what the browser EXECUTES ----------------------
test('guard negatives: drift after bind, a deep link with other bytes, a redirect, a foreign, unreviewed or changed script: refused, host-build FAIL, and the journey stops before any password is typed', async () => {
  for (const [bug, named] of [
    [{ driftAfter: 1 }, /document https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/ differs from the reviewed \/ document/],
    [{ deepLinkDiffers: true }, /document https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/kiosk\/e5cgrp-e5c-t-1-lk\/e5cgoal-e5c-t-1-lk differs from the reviewed \/kiosk\/\$communityId\/\$goalId document/],
    [{ redirectDoc: true }, /answered HTTP 302, not the reviewed file/],
    [{ foreignScript: true }, /script https:\/\/cdn\.example\.test\/x\.js is outside the reviewed build/],
    [{ foreignOnJoin: true, linkJoinable: true }, /script https:\/\/cdn\.example\.test\/join\.js is outside the reviewed build/],
    [{ foreignOnHome: true }, /script https:\/\/cdn\.example\.test\/home\.js is outside the reviewed build/],
    [{ extraChunk: true }, /script https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/assets\/extra-ZZZ\.js is not a reviewed asset/],
    [{ changedChunk: true }, /assets\/kiosk-BBB\.js differs from its reviewed digest/],
  ]) {
    const L = lovable(bug);
    const r = await runJourney({ browser: L.browser, fixtures: L.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
    const row = hostBuildRow({ status: 'PASS', reason: 'bind' }, r.served);
    assert.equal(row.status, 'FAIL', JSON.stringify(bug));
    assert.match(row.seen, named, JSON.stringify(bug));
    assert.doesNotMatch(row.seen, /join=|JOINCODE|\?/, 'no query in what is named');
    assert.equal(L.server.passwordFills, 0, `${JSON.stringify(bug)}: no password is typed into an unreviewed build`);
    if (!bug.driftAfter && !bug.foreignOnJoin && !bug.foreignOnHome) assert.equal(L.tracked.approvals, 0, `${JSON.stringify(bug)}: an unreviewed kiosk is never approved (it would receive the station secret)`);
    assert.equal(L.server.contributions, 0, `${JSON.stringify(bug)}: nothing is written`);
    assert.deepEqual(r.productDocs, []);
    assert.ok(!PASSING.some((id) => id !== 'fixture-provenance' && statusOf(r.rows, id) === 'PASS'), `${JSON.stringify(bug)}: no product row passes on an unreviewed build`);
    assert.equal(L.browser.closed, L.opened(), `${JSON.stringify(bug)}: every context is closed`);
  }
  // A foreign script requested later in the run (a lazy load) is refused too, and fails host-build after the fact.
  const late = lovable({ lateForeignScript: true });
  const r = await runJourney({ browser: late.browser, fixtures: late.fixtures, base: LOVABLE_URL, reviewed: FAKE_REVIEWED });
  assert.match(hostBuildRow({ status: 'PASS' }, r.served).seen, /script https:\/\/cdn\.example\.test\/late\.js is outside/);
  assert.equal(hostBuildRow({ status: 'PASS' }, r.served).status, 'FAIL');
  assert.ok(!late.server.loads.some((x) => x.url.includes('cdn.example.test')), 'the foreign script was never fulfilled');
  // The production default is the shipped REVIEWED_BUILD (the real pin): the fake host's very first document is refused.
  const empty = lovable();
  const e = await runJourney({ browser: empty.browser, fixtures: empty.fixtures, base: LOVABLE_URL });
  assert.match(hostBuildRow({ status: 'PASS' }, e.served).seen, /\/kiosk\/e5cgrp-e5c-t-1-lk\/e5cgoal-e5c-t-1-lk (carries \d+ NUL character\(s\), not the reviewed \d+|differs from the reviewed \/kiosk\/\$communityId\/\$goalId document)/);
  assert.equal(empty.server.passwordFills, 0);
});

test('classifyRequest: the reviewed host verifies documents and /assets/ code; API origins pass data only; everything else is refused', () => {
  const R = FAKE_REVIEWED;
  const L = LOVABLE_URL;
  const c = (url, type, navigation = false) => classifyRequest({ url, type, navigation }, R);
  assert.deepEqual(c(`${L}/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk?join=SECRETCODE`, 'document', true), { action: 'verify', kind: 'document', template: '/kiosk/$communityId/$goalId', want: R.documents['/kiosk/$communityId/$goalId'], what: `document ${L}/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk` });
  assert.deepEqual(c(`${L}/?join=SECRETCODE&goal=e5cgoal-e5c-t-1-lk`, 'document', true), { action: 'verify', kind: 'document', template: '/', want: R.documents['/'], what: `document ${L}/` });
  assert.equal(c(`${L}/display/e5cgoal-e5c-t-1-dm1`, 'document', true).want, R.documents['/display/$goalId']);
  assert.deepEqual(c(EVENTS_SCRIPT, 'script'), { action: 'block', what: `script ${EVENTS_SCRIPT}` }, 'the host events script is blocked');
  assert.deepEqual(c(FLOCK_SCRIPT, 'script'), { action: 'block', what: `script ${FLOCK_SCRIPT}` }, 'and the host\'s ~flock.js');
  assert.equal(c(`${L}/__l5e/events.1718a1eacac7ff3a.js`, 'script').action, 'block', 'the real events id (bind runs 38007859514, 38017456574 and 38018743683) is blocked');
  // The events id is exactly 16 lower-case hex digits, and the dots are literal (#394 6092810294 item 5): each of these
  // is refused, never blocked.
  assert.equal(c(`${L}/__l5e/events.0123456789abcdef.js`, 'script').action, 'block', 'an id with every hex digit is blocked (W3 F5)');
  for (const id of ['-', '_', 'a1b2c3d4e5f6-718', 'a1b2c3d4e5f6_718', 'a'.repeat(5000), '', 'a1b2c3d4.5f60718', 'a1b2c3d4e5f6%718', 'a1b2c3d4e5f6~718', 'a1b2c3d4e5f6071', 'a1b2c3d4e5f607189', 'A1B2C3D4E5F60718', 'a1b2c3d4e5f6071g']) {
    const v = c(`${L}/__l5e/events.${id}.js`, 'script');
    assert.equal(v.action, 'abort', `events id ${id.slice(0, 20)}`);
    assert.match(v.reason, /is not a reviewed asset$/);
  }
  for (const p of ['/__l5e/eventsXa1b2c3d4e5f60718.js', '/__l5e/events.a1b2c3d4e5f60718Xjs', '/~flockXjs']) assert.equal(c(`${L}${p}`, 'script').action, 'abort', `${p}: a dot is a dot`);
  // Userinfo (N2's other half, #394 6092810294 items 6 and 7): refused, not blocked, and named without being printed.
  for (const [url, type, nav] of [['https://user@we-stay-fit-foundation-trial.lovable.app/~flock.js', 'script'], ['https://u:p@we-stay-fit-foundation-trial.lovable.app/__l5e/events.a1b2c3d4e5f60718.js', 'script'],
    ['https://user@we-stay-fit-foundation-trial.lovable.app/assets/shell-AAA.js', 'script'], ['https://u:p@we-stay-fit-foundation-trial.lovable.app/', 'document', true], ['https://:p@we-stay-fit-foundation-trial.lovable.app/~flock.js', 'script'],
    ['https://user@we-stay-fit-foundation-trial.lovable.app/favicon.ico', 'image'], ['https://u:p@we-stay-fit-foundation-trial.lovable.app/data.json', 'fetch']]) { // images and data too (W3 F6)
    const v = c(url, type, nav);
    assert.equal(v.action, 'abort', url);
    assert.match(v.reason, /^(script|document|image|fetch) https:\/\/we-stay-fit-foundation-trial\.lovable\.app\/\S* carries userinfo \(not printed\), which no reviewed request has$/, url);
    assert.doesNotMatch(v.reason, /user@|u:p|:p@/, 'the userinfo itself is never printed');
  }
  assert.equal(c(`${L}/assets/shell-AAA.js`, 'script').want, R.assets['shell-AAA.js']);
  assert.equal(c(`${L}/assets/index-CCC.css`, 'stylesheet').want, R.assets['index-CCC.css']);
  for (const [url, type] of [[`${L}/favicon.ico`, 'image'], [`${L}/font.woff2`, 'font'], [`${L}/manifest.json`, 'manifest']]) assert.equal(c(url, type).action, 'continue', `${type}`);
  for (const o of API_ORIGINS) for (const t of ['fetch', 'xhr', 'eventsource']) assert.equal(c(`${o}/v1/x?key=abc`, t).action, 'continue', `${o} ${t}`);
  for (const [url, type, nav] of [
    [`${L}/assets/other-ZZZ.js`, 'script'], [`${L}/sw.js`, 'script'], [`${L}/c/e5cgrp-e5c-t-1-lk/g/e5cgoal-e5c-t-1-lk`, 'document', true], [`${L}/try`, 'document', true],
    [EVENTS_SCRIPT, 'stylesheet'], [`${L}/__l5e/other.js`, 'script'], [`${L}/__l5e/events.x.js/../evil.js`, 'script'], [`${L}/__l5e/events.a1b2c3d4e5f60718.js`, 'document', true],
    [FLOCK_SCRIPT, 'stylesheet'], [`${L}/~flock.js`, 'document', true], [`${L}/~flockX.js`, 'script'], [`${L}/a/~flock.js`, 'script'], [`${L}/~flock.mjs`, 'script'], ['https://cdn.example.test/~flock.js', 'script'],
    [`${L}/~flock.js?v=1`, 'script'], [`${L}/~flock2.js`, 'script'], [`${L}/x/~flock.js`, 'script'], [`${L}/~flock.js#a`, 'script'], [`${EVENTS_SCRIPT}?v=1`, 'script'],
    [`${L}/~flock.js/x`, 'script'], [`${L}/~flock.json`, 'script'], [`${L}/~flock.js.map`, 'script'], [`${L}/~FLOCK.JS`, 'script'],
    [`${EVENTS_SCRIPT}/x`, 'script'], [`${L}/__l5e/events.a1b2c3d4e5f60718.jsonp`, 'script'], [`${L}/x/__l5e/events.a1b2c3d4e5f60718.js`, 'script'], [`${L}/__l5e/events.a/b.js`, 'script'],
    [`${L}/~flock.js?`, 'script'], [`${L}/~flock.js#`, 'script'], [`${EVENTS_SCRIPT}?`, 'script'], [`${EVENTS_SCRIPT}#`, 'script'],
    [`${L}/__L5E/events.a1b2c3d4e5f60718.js`, 'script'], [`${L}/__l5e/EVENTS.a1b2c3d4e5f60718.JS`, 'script'], [`${L}/elsewhere/shell-AAA.js`, 'script'], [`${L}/assets/sub/shell-AAA.js`, 'script'], [`${L}/assets/shell-AAA.js/../x.js`, 'script'], [`${L}/x`, 'websocket'],
    ['https://identitytoolkit.googleapis.com/x.js', 'script'], ['https://firestore.googleapis.com/', 'document', true], ['https://us-central1-westayfit-staging.cloudfunctions.net/x', 'image'],
    ['https://cdn.example.test/x.js', 'script'], ['https://fonts.googleapis.com/css', 'stylesheet'], ['https://evil.example.test/api', 'fetch'],
    ['https://we-stay-fit-foundation-trial.lovable.app.evil.test/', 'document', true], ['http://we-stay-fit-foundation-trial.lovable.app/', 'document', true], ['not a url', 'script'],
  ]) {
    const v = c(url, type, nav);
    assert.equal(v.action, 'abort', `${type} ${url}`);
    assert.doesNotMatch(v.reason, /key=|\?/, 'never a query');
  }
  assert.equal(classifyRequest({ url: `${L}/`, type: 'document', navigation: true }).want, REVIEWED_BUILD.documents['/'], 'the production default is the shipped pin');
  assert.equal(c('https://cdn.example.test/__l5e/events.a1b2c3d4e5f60718.js', 'script').action, 'abort', 'the block is the Lovable host\'s own path only');
});

test('classifyRequest (LOVABLE-GUARD-PING-1): a ping is data to the exact API origins only; never a navigation, never to the Lovable host or another origin', async () => {
  const R = FAKE_REVIEWED;
  const L = LOVABLE_URL;
  const c = (url, type, navigation = false) => classifyRequest({ url, type, navigation }, R);
  // Firestore's WebChannel closing a Listen channel with navigator.sendBeacon: the request whose refusal stopped the
  // kiosk journey of main run 38030033477 (#365 6094589482). Playwright reports it as resource type ping.
  const PATH = '/google.firestore.v1.Firestore/Listen/channel';
  const LISTEN = `https://firestore.googleapis.com${PATH}?VER=8&database=projects%2Fwestayfit-staging%2Fdatabases%2F(default)&gsessionid=g1&SID=s1&RID=rpc&TYPE=terminate&zx=z1&t=1`;
  assert.deepEqual(c(LISTEN, 'ping'), { action: 'continue', what: `ping https://firestore.googleapis.com${PATH}` }, 'the Listen close beacon is continued, named with no query');
  for (const o of API_ORIGINS) assert.equal(c(`${o}/v1/x?key=abc`, 'ping').action, 'continue', `${o} ping`);
  for (const [url, type, nav, why] of [
    [LISTEN, 'ping', true, 'a ping that is a navigation'],
    [`${L}/`, 'ping', false, 'a ping to the Lovable host'], [`${L}${PATH}`, 'ping', false, 'the Listen path on the Lovable host'], [`${L}/assets/shell-AAA.js`, 'ping', false, 'a ping to a reviewed asset path'],
    [`https://evil.example.test${PATH}`, 'ping', false, 'a foreign origin'], [`https://firestore.googleapis.com.evil.test${PATH}`, 'ping', false, 'a look-alike host'],
    [`https://evil.test/https://firestore.googleapis.com${PATH}`, 'ping', false, 'an API origin in the path'], [`http://firestore.googleapis.com${PATH}`, 'ping', false, 'plain http'],
    [`https://firestore.googleapis.com:8443${PATH}`, 'ping', false, 'another port'], ['https://us-central1-goarrive.cloudfunctions.net/x', 'ping', false, 'another project\'s callables'],
    ['https://googleapis.com/x', 'ping', false, 'the parent domain'], [LISTEN, 'Ping', false, 'a type spelled otherwise'],
  ]) {
    const v = c(url, type, nav);
    assert.equal(v.action, 'abort', why);
    assert.doesNotMatch(v.reason, /key=|\?/, 'never a query');
  }
  // Data, never code: a script, document or stylesheet to any API origin stays refused, navigation or not.
  for (const o of API_ORIGINS) for (const type of ['script', 'document', 'stylesheet']) for (const nav of [false, true]) assert.equal(c(`${o}${PATH}`, type, nav).action, 'abort', `${type} ${o} navigation=${nav}`);
  // Through the guard itself: the beacon is continued with no refusal; a Lovable-host ping is refused and check() throws.
  const route = (url, type) => {
    const out = {};
    return { out, r: { request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => false }), async continue() { out.continued = true; }, async abort(code) { out.aborted = code; } } };
  };
  const g = codeGuard(R);
  const beacon = route(LISTEN, 'ping');
  await g.handle(beacon.r);
  assert.deepEqual([beacon.out, g.summary().violations], [{ continued: true }, []]);
  g.check();
  const hostPing = route(`${L}/`, 'ping');
  await g.handle(hostPing.r);
  assert.deepEqual(hostPing.out, { aborted: 'blockedbyclient' });
  assert.deepEqual(g.summary().violations, [`ping ${L}/ is not a permitted resource type`]);
  assert.throws(() => g.check());
});

test('codeGuard: fulfils exactly the hashed bytes once verified; refuses a redirect, an error, other bytes or an unreadable answer; check() throws after any refusal', async () => {
  const route = (url, type, navigation, answer) => {
    const out = {};
    return { out, r: {
      request: () => ({ url: () => url, resourceType: () => type, isNavigationRequest: () => navigation }),
      async fetch(o) { out.maxRedirects = o?.maxRedirects; if (answer instanceof Error) throw answer; return { status: () => answer.status, headers: () => ({ 'content-type': answer.type ?? (type === 'document' ? 'text/html; charset=utf-8' : 'text/javascript') }), body: async () => Buffer.from(answer.body) }; },
      async fulfill({ body, headers }) { out.fulfilled = String(body); if (headers) out.contentType = headers['content-type']; },
      async continue() { out.continued = true; },
      async abort(code) { out.aborted = code; },
    } };
  };
  const g = codeGuard(FAKE_REVIEWED);
  const kioskDoc = servedDoc('/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk');
  const ok = route(`${LOVABLE_URL}/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk`, 'document', true, { status: 200, body: kioskDoc });
  await g.handle(ok.r);
  assert.deepEqual(ok.out, { maxRedirects: 0, fulfilled: kioskDoc, contentType: 'text/html; charset=utf-8' }, 'the document is fulfilled with exactly the bytes read, as UTF-8 HTML');
  // R7: no charset, or UTF-8 spelled any way, is accepted, and the browser is told UTF-8 whatever the host said.
  for (const type of ['text/html', 'text/html;charset="UTF-8"', 'TEXT/HTML; Charset=utf8']) {
    const one = codeGuard(FAKE_REVIEWED);
    const x = route(`${LOVABLE_URL}/kiosk/e5cgrp-e5c-t-1-lk/e5cgoal-e5c-t-1-lk`, 'document', true, { status: 200, body: kioskDoc, type });
    await one.handle(x.r);
    assert.deepEqual([x.out.fulfilled, x.out.contentType, one.summary().violations], [kioskDoc, 'text/html; charset=utf-8', []], type);
  }
  const ev = route(EVENTS_SCRIPT, 'script', false, { status: 200, body: 'track()' });
  await g.handle(ev.r);
  assert.deepEqual(ev.out, { aborted: 'blockedbyclient' }, 'the host events script is never fetched or fulfilled');
  const api = route('https://firestore.googleapis.com/v1/x', 'xhr', false, null);
  await g.handle(api.r);
  assert.deepEqual(api.out, { continued: true });
  g.check();
  assert.deepEqual(g.summary(), { verified: 1, violations: [], blocked: [`script ${EVENTS_SCRIPT}`] });
  for (const [answer, why] of [[{ status: 302, body: '' }, /HTTP 302/], [{ status: 500, body: servedDoc('/') }, /HTTP 500/], [{ status: 200, body: `${servedDoc('/')} ` }, /differs/], [new Error('net::ERR_FAILED https://x?token=abc'), /could not be read/]]) {
    const one = codeGuard(FAKE_REVIEWED);
    const x = route(`${LOVABLE_URL}/`, 'document', true, answer);
    await one.handle(x.r);
    assert.equal(x.out.aborted, 'blockedbyclient');
    assert.equal(x.out.fulfilled, undefined, 'nothing unverified is fulfilled');
    assert.match(one.summary().violations[0], why);
    assert.doesNotMatch(one.summary().violations[0], /token=abc/);
    assert.throws(() => one.check(), /served code outside the reviewed build/);
  }
  // Asset charset (LOVABLE-REVIEWED-BUILD-2): a reviewed asset declared in another charset is refused, so it is never
  // fulfilled with that charset; one declared with no charset or UTF-8 is fulfilled with exactly its bytes and the
  // host's own response headers (nothing overridden).
  const [assetPath, assetBody] = Object.entries(FAKE_ASSETS)[0];
  const assetRoute = (type, kind = 'script', at = assetPath, bytes = assetBody) => {
    const out = {};
    return { out, r: {
      request: () => ({ url: () => `${LOVABLE_URL}${at}`, resourceType: () => kind, isNavigationRequest: () => false }),
      async fetch() { return { status: () => 200, headers: () => ({ 'content-type': type, 'cache-control': 'public, max-age=31536000' }), body: async () => Buffer.from(bytes) }; },
      async fulfill(o) { out.fulfilled = { body: String(o.body), headers: o.headers, type: o.response?.headers()['content-type'], kept: o.response?.headers()['cache-control'] }; },
      async continue() { out.continued = true; },
      async abort(code) { out.aborted = code; },
    } };
  };
  for (const type of ['text/javascript; charset=windows-1252', 'text/javascript; CHARSET=windows-1252', 'application/javascript; charset="utf-16le"', 'text/javascript; charset=utf-8; charset=windows-1252',
    'text/javascript;\tcharset=windows-1252', 'text/javascript;  charset=windows-1252', 'text/javascript, text/javascript; charset=windows-1252']) { // W3 F2, F3
    const one = codeGuard(FAKE_REVIEWED);
    const x = assetRoute(type);
    await one.handle(x.r);
    assert.deepEqual(x.out, { aborted: 'blockedbyclient' }, `${type}: never fulfilled`);
    assert.deepEqual(one.summary().violations, [`script ${LOVABLE_URL}${assetPath} is ${assetTypeProblem(type)}`], type);
    assert.match(one.summary().violations[0], /is served with charset .+, not UTF-8$/, type);
    assert.throws(() => one.check(), /served code outside the reviewed build/, type);
  }
  const css = codeGuard(FAKE_REVIEWED);
  const cssRoute = assetRoute('text/css; charset=windows-1252', 'stylesheet', '/assets/index-CCC.css', FAKE_ASSETS['/assets/index-CCC.css']);
  await css.handle(cssRoute.r);
  assert.deepEqual([cssRoute.out, css.summary().violations], [{ aborted: 'blockedbyclient' }, [`stylesheet ${LOVABLE_URL}/assets/index-CCC.css is served with charset windows-1252, not UTF-8`]], 'a stylesheet the same way');
  for (const type of ['text/javascript', 'text/javascript; charset=utf-8', 'application/javascript;charset="UTF-8"']) {
    const one = codeGuard(FAKE_REVIEWED);
    const x = assetRoute(type);
    await one.handle(x.r);
    assert.deepEqual(x.out, { fulfilled: { body: assetBody, headers: undefined, type, kept: 'public, max-age=31536000' } }, `${type}: fulfilled with its bytes and the host's own headers`);
    assert.deepEqual(one.summary(), { verified: 1, violations: [], blocked: [] }, type);
  }
  const foreign = codeGuard(FAKE_REVIEWED);
  const f = route('https://cdn.example.test/x.js', 'script', false, { status: 200, body: 'x' });
  await foreign.handle(f.r);
  assert.equal(f.out.maxRedirects, undefined, 'a refused request is never fetched');
  assert.equal(f.out.aborted, 'blockedbyclient');
});

test('runResults: host-build in the written results is the bind joined with what the browser was served, never the bind alone', () => {
  const allRows = Object.fromEntries(ROWS.map((r) => [r.id, { status: 'PASS', seen: '' }]));
  const clean = runResults({ status: 'PASS', reason: 'bind' }, { rows: allRows, served: { verified: 5, violations: [] } });
  assert.equal(clean.rows.find((r) => r.id === 'host-build').status, 'PASS');
  assert.equal(allPassed(clean), true);
  for (const journey of [{ rows: allRows, served: { verified: 5, violations: ['script https://cdn.example.test/x.js is outside'] } }, { rows: allRows }, { rows: { ...allRows, 'host-build': { status: 'PASS', seen: 'claimed by the journey' } }, served: { verified: 0, violations: [] } }]) {
    const doc = runResults({ status: 'PASS', reason: 'bind' }, journey, { 'cleanup-tracking': { status: 'PASS', seen: '' } });
    assert.equal(doc.rows.find((r) => r.id === 'host-build').status, 'FAIL', JSON.stringify(journey.served));
    assert.equal(allPassed(doc), false);
  }
  assert.equal(runResults({ status: 'BLOCKED', reason: 'nothing pinned' }, { rows: {} }).rows.find((r) => r.id === 'host-build').status, 'BLOCKED');
});

test('hostBuildRow and browserEnv: PASS needs the bind, a verified load and no refusal; the browser gets no cloud or workflow credential', () => {
  assert.deepEqual(hostBuildRow({ status: 'BLOCKED', reason: 'nothing pinned' }, { verified: 3, violations: [] }), { status: 'BLOCKED', seen: 'nothing pinned' });
  assert.equal(hostBuildRow({ status: 'PASS' }, undefined).status, 'FAIL', 'the browser never ran');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 0, violations: [] }).status, 'FAIL');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 4, violations: ['script x'] }).status, 'FAIL');
  assert.equal(hostBuildRow({ status: 'PASS' }, { verified: 4, violations: [] }).status, 'PASS');
  assert.match(hostBuildRow({ status: 'PASS' }, { verified: 4, violations: [], blocked: ['script a', 'script b'] }).seen, /2 host script request\(s\) blocked, not run/);
  const env = browserEnv({ PATH: '/bin', HOME: '/h', WSF_RESULT_DIR: '/r', WSF_GOOGLE_ACCESS_TOKEN: 't', GOOGLE_APPLICATION_CREDENTIALS: '/k', GOOGLE_CLOUD_PROJECT: 'p', CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: '/f', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'o', ACTIONS_ID_TOKEN_REQUEST_URL: 'u', ACTIONS_RUNTIME_TOKEN: 'r', GITHUB_TOKEN: 'g', GH_TOKEN: 'h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', WSF_RESULT_DIR: '/r' });
});

test('canonical shapes: ownCredit is read for the selected goal only, and null is never a number', () => {
  assert.equal(ownCreditOf({ data: { goalId: 'g' }, result: { ownCredit: 7, unit: 'squats' } }, 'g'), 7);
  assert.equal(ownCreditOf({ data: { goalId: 'h' }, result: { ownCredit: 7 } }, 'g'), null, 'another goal');
  assert.equal(ownCreditOf({ data: { goalId: 'g' }, result: { total: 7 } }, 'g'), null, 'no invented field');
  assert.equal(ownCreditOf(null, 'g'), null);
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: { sharedTotal: 107 } }, 'g'), 107);
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: {} }, 'g'), null);
  assert.equal(sharedOf({ data: { goalId: 'h' }, result: { sharedTotal: 107 } }, 'g'), null, 'another goal');
  assert.equal(sharedOf({ data: { goalId: 'g' }, result: { sharedTotal: 107.5 } }, 'g'), null, 'not a whole number');
});

for (const [name, fn] of pending) { await fn(); passed += 1; console.log(`  ok  ${name}`); }
console.log(`hosted-lovable-kiosk: ${passed} passed`);
