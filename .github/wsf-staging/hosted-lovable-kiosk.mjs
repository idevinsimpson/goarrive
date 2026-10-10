#!/usr/bin/env node
/**
 * LOVABLE-KIOSK-HOSTED-PROOF-1 (Director #365 6044515892, release 6044894488): the signed-in kiosk proof against the
 * Lovable Web Twin, run ONLY by the `lovable-kiosk` mode of the trusted staging workflow. Proof only: it builds and
 * deploys nothing, and it never runs against any host but LOVABLE_URL or any project but westayfit-staging.
 *
 *   --bind     credential-free (the gate job): load the documents of every route template the journeys use (BIND_PROBES),
 *              reduce each to its canonical form (canonicalDocument), read the served assets, hash every one, and
 *              compare all of it to REVIEWED_BUILD below. Exit 0 only on an exact match. An empty REVIEWED_BUILD
 *              (nothing reviewed yet), a changed document, a missing, extra or changed asset, an asset declared in a
 *              charset other than UTF-8, a document reference the code guard would refuse, or an unreadable host
 *              refuses BEFORE any credential exists, and prints the
 *              observed manifest (templates, names and sha256 only) so a reviewed commit can pin it.
 *   --run      credentialed (the lovable-kiosk job): bind again (drift since the gate refuses), then seed run-tagged
 *              fixtures with the EXISTING kit (journeys/fixture-kit.mjs) and drive the real Lovable UI. Every browser
 *              context routes its requests through codeGuard (Playwright routes every request except a WebSocket
 *              handshake and the redirect hops of a request the guard continued; those carry data, never code, as
 *              before this packet): each document the browser loads must reduce to its
 *              template's reviewed canonical document, and each /assets/ script or stylesheet must carry its reviewed
 *              digest (both fulfilled with exactly the bytes read; a document or asset declared in a charset other than
 *              UTF-8 is refused); the host's own injected scripts are blocked, and
 *              nothing else executable is loaded; a refusal fails host-build and stops the journey before the next
 *              step. The browser runs with no cloud or workflow credential in its environment. Every row is PASS,
 *              FAIL or BLOCKED; results are written in `finally`; exit 0 only when every row passed.
 *   --require  after blocking cleanup and the evidence scan: recompute the verdict from the written results and the
 *              cleanup and scan outcomes. Exit 0 only on every row PASS, cleanup success and scan success.
 *
 * WHAT IS NOT CLAIMED (rows stay BLOCKED, named):
 *  - the station turn rows (queue place, call, phone-ready, expected-turn start, 60-second round, review, station
 *    Finish): the safe station backend (#587, integrated in source) is not served on staging and this proof has no
 *    station driver yet, and an older station path is never driven;
 *  - the genuinely unverified account: the existing kit creates verified accounts only (#396 6043231980), and no
 *    verification is faked;
 *  - the Champion's approval is the kit's Champion callable (tracked for cleanup), not the Champion UI.
 *  - the QR join with the existing kit: its communities are private, so the served kiosk shows no join code; qr-join is
 *    BLOCKED by name and never gates the phone rows.
 * The phone rows are measured by a CONTROL: the kit's verified member of the event community (made, like the Champion,
 * as fixture preparation), signed in through the product UI. Visitor A (not a member) joins through the real QR link
 * whenever the community is link-joinable; visitor B (not a member) is the isolation check.
 *
 * Secrets: account passwords exist only in memory (the kit's), never in a result, log line or file. Identities are
 * recorded as a short sha256 of the uid. Nothing here writes to the Lovable project.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const LOVABLE_URL = 'https://we-stay-fit-foundation-trial.lovable.app';
export const PROJECT_ID = 'westayfit-staging';
/**
 * The reviewed served build (LOVABLE-REVIEWED-BUILD-1, queue #365 6090733639), shared by the lovable-kiosk and
 * lovable-device-matrix proofs:
 *  - documents: for each route template the journeys load, the sha256 of its canonical document (canonicalDocument:
 *    its inline scripts, the references it loads and every other byte, with only the two per-request values
 *    normalized and the URL's own params in their slots), the number of `u:` timestamps its stream part carries, and
 *    the number of NUL characters it carries (Director ruling #394 6091249662: kept as bytes, counted strictly);
 *  - assets: asset name -> sha256 of its bytes, exact.
 * Pinned to exactly the manifest a credential-free `--bind` run of this code printed (below). An empty value stops
 * every run in the credential-free gate; a served build that differs in any document, timestamp or NUL count, or asset
 * fails it. An observed digest is evidence for review, never self-approval. A later Lovable publish needs only a new
 * value here, from a new bind.
 */
export const REVIEWED_BUILD = Object.freeze({
  // Lovable db3fd2f2 on the trial host: exactly the LOVABLE_OBSERVED_BUILD line of the credential-free gate bind run
  // 38018743683 (main 6e8acc31, gate job 114114813301, 02:56Z; L0 #394 6093058625), from two transcriptions of its log.
  // STALE under step C: those digests are step B's canonical form, so the two param templates cannot match until the
  // re-pin from L0's step C gate samples (#394 6093295458). Step C adds only the img counts its shape requires (0 on `/`,
  // 2 on each param template, as DEEPLINK-DRIFT-CONFIRM-1 shows, #394 6093468966); `/`'s digest is unchanged by step C.
  documents: Object.freeze({
    '/': Object.freeze({ sha256: '55f9d9a35c95aeea889644ef8c9408aae6617f32c22de187a134516892b93b03', streamU: 2, nul: 3, img: 0 }),
    '/display/$goalId': Object.freeze({ sha256: 'b15d36a06b362063ab8b0817d8d35a8e51982dc5b80630420b473e6ec79db2ae', streamU: 2, nul: 5, img: 2 }),
    '/kiosk/$communityId/$goalId': Object.freeze({ sha256: 'f9a8996609e0e4e6168174263d4cba53e7a3868c67e10fc44cc194cb22934398', streamU: 2, nul: 7, img: 2 }),
  }),
  assets: Object.freeze({
    'auth-gate-DazlXpxN.js': 'cc598cd6a7f593cc1a983eb248b1d19833ce028232d3cfd8b3d8eac575245ba9',
    'backend-CHV7mKiZ.js': 'e13168d2bec4bc305584baff3284108e49336fbe5205615293f3f14a8fca836e',
    'c._communityId.g._goalId-DHc3AuoY.js': 'cc20229b942b69a619ba998c8ec66a4e7362758bac383b92d5bfe0b188832ffd',
    'camera-count-UdAbT5q_.js': '0e2f034e692b3c2d206b33ae500ca2018f0d64f48970a99bda3053f59b1715b5',
    'camera-diagnostic-C9xjCGaL.js': 'd072646781e158d3d3860e9a05e20c492610847462e944d68bdc11114c478ded',
    'camera-timing-CVkiW1wJ.js': '2957f0076d152f2d7ae5a4790d7e3edb518e114e7ff7307c0691ea1db9b6154a',
    'canonical-CHbNeHlW.js': 'b9317bc0aba280864f045af3cbf81e40e3fcf29c49766830ceb441c6d3f72433',
    'canonical-create-BxD7WHfR.js': 'b8660cb7936221b1d583614bf936ce190167db8771469be1565e232ed739daef',
    'canonical-map-Bq9gOxTr.js': 'd239285903abe093441623e7841ca1634da22599078c92ea533470bc70462662',
    'canonical-session-BZh7Slc1.js': 'cbb82426aa20b655835aac9185fb64a05c0a6d66329eb9208d31265769d56848',
    'connected-context-Be1P8Ppw.js': '4d8e9b9c222026af2b758e0f1a713c142d629965153c8f9f82b01e4e26149839',
    'connected-join-DfJm5Hrx.js': '96541f99a85a6b60828a1638c39c70cf1478e761baec2d32997efa8cbe3dfcf3',
    'connected-kiosk-Bst7S2yO.js': '966931f53de3274e50b30fc3f6428b5d6e1371d9e910f4c91d8305327c79fe8e',
    'connection-status-DTZA9aGE.js': '3c0be2687a5c77fc268a59ba24bdca0af8d0fe0edc000fac8fe706ffaa4eeae0',
    'controller-CSxv0Ec_.js': 'cfef934cc74ab5b7e75c96bbb919a0a861c8f89ac5c922e64724a62614ca960c',
    'display._goalId-CxJPCYDi.js': '02158d02915ad63956cd06084e16327fb2774082c95e3c30bac80bef6459a511',
    'eligibility-DWVA9M9T.js': '2a0b5d1297fc3763a57a6c20b4e6a9aeac653ae2d9378752f3e7db0f6fbaed43',
    'entry-destination-lVvziW3p.js': 'd68548296f804aaf7645682b3c924da2e7a2fc894b78d7e104f61f806acd573d',
    'firebase-auth-port-D79B6xJa.js': '74e7e05cd41dd1de9659bebe98a6bc6da7903e801b1ec13e800cb544f2c9b2f8',
    'firebase-ports-BDGFoXSp.js': 'e53eb4a81950d59f0490412caf5236a88243fe0f0f23473e51256be352b5ec45',
    'firebase-runtime-CZCcqTxd.js': '071b0c117e3f15e23588ab4283fdfb1c47ce3fdc0cb418f605b1a5271d18c483',
    'firebase-sdk-X-4Auvgo.js': '3651b41db8eb64d8dceb48d8efc2d27e6ee967dc0f92598168ec9918d121150f',
    'go._markerKey-BONbFHMz.js': '7a754c9c56cd7202c894b17141b133cdf5c7dc8a73b06e1919d140a53821ceb4',
    'held-frames-Dt4ozcaJ.js': 'd47b99a30d7f6dc60114cf6d8545d318104aedd26e9d3fe848bd35484659f355',
    'id-token-C8A-OuIA.js': 'b72caaa5de3f1298bea701a7626761e32d0355b98fe08a2db56f6732f525c9bb',
    'index-BwrWDHpN.js': '986b78eb95fc12176095614f25c696b289c3508b420aa28a2ead755098668629',
    'index.esm-BjbmKAGS.js': '6941d1dbec4e9c73d6a144499ed99e097b3852ef2494e740a74e56e3a4583e03',
    'index.esm-Cn5cOIBK.js': '799bbbb722de50690d3f9d06d67c4d06b4ec77bdab5227b152c1d9e0025d7ad4',
    'index.esm-DXNZSBE7.js': '4d3d55320f3a52f31e22245267a5a7ef57768c29fb2fb0957176cd874af17925',
    'index.esm-p4pn-KSj.js': '4e92fb34f0e8a6a3ec4b983012267552c9ea7da2fd7972a2113eae7a9f617422',
    'index.esm2017-ceQX5uT7.js': '1c4fa5886c84a91cf9b398ca94e3125d8b9abb40b11eec2d393d4bfd6b6801aa',
    'injected-fixtures-C779UBag.js': '79aa5c1aa7041c516eb52a359ffa494ad6aa320b93ffa439819bb155483e8153',
    'invariant-CgFvOqN2.js': '9581f7b30cfddeea2063d0f9ee9c4712ebd265221d0caa1b8b78828399b5e883',
    'jsx-runtime-B-hcVAMW.js': '6eab4df858048a4840a5d08754d84773f3f0de0ea0c4bb58e0e0abca99d1d973',
    'kiosk-replies-DZd2kJ3_.js': '6708005c5ddb01ef3de4ce609e5612a10baa0160c1dc3e95137b9a2435a0e286',
    'kiosk._communityId._goalId-DaewtBPC.js': '20cac2bbbce88a9223088946d8848466fa6f5fbe529b1861eda4fe7d4d18af78',
    'lab-gate-cpy8A4Tt.js': 'c3df1c4d3fd0e7eb8b31b6215383255f68b6cb7347971592aff5a0af8fec31d6',
    'lazyRouteComponent-B2uEu2lU.js': 'f2dd31beb68efe7567a95c52e98949daeaa1feea179a5d3fa60fdb9538f42411',
    'legacyPoseEstimator-B4pnWXLw.js': '703000642ba5d27c0777e86e65efac7d07274176ffa9faee016262f744b66c4f',
    'link-DYTdnZ8s.js': '68e620a918e2fe0f9ed7abcaabf80c3c5541d37732f5c79ac53b61175718dc42',
    'matchContext-B0YTMpvO.js': '02279403e4abee05c956dc1925aaa3e5d5314aeeeddd45274b5f3ec8df3e8060',
    'member-entry-screen-DzlmoY2q.js': 'b55deaf9b33263b3f7dffc9e95b1bcb162670ae0cf6768c8769ca5abc3f948eb',
    'model-init-reason-DwV0JOVp.js': '290d50b9a9b0c44ccc0e641194196120cee1d328c2ce2de541f5b077625db934',
    'not-found-DIgawKw1.js': 'ac8e8967ff892a5b649d743b4cb012a73eb22845ecac5325129d4ec5c99c83fc',
    'organizer-setup-BZNesh5V.js': '126f9dcdebcb13779bf26df4415b0cda300470ae939b3260aeb0db6c29e130a2',
    'policy-page-yxFgd9fE.js': 'e0e73acbc20e480e5e80093cbd1c35e876b6feade1455eb4c0a0d1685c195b58',
    'preload-helper-Czpn1I53.js': 'aba87f2a53e45ecdc9113fc30387d16e449d1676428cf5f82dd624c1df97d152',
    'preview-activation-DN4CVkRP.js': '529f6e39433e47190ef9b85858a7bc04d9e14b8378f8cbba9471ec87a3c24a11',
    'privacy-C1iJwHhR.js': '1462663b1314c7adc92fbe833edac34566bc793c1ad2c5d6d4871b8d950c1e87',
    'production-surface-t6HCbi7O.js': 'cea286462b0216df88fb643af4d9e1602e686a5ef96d69dcda6ed22c0d30f886',
    'registry-DHe69nAa.js': 'dcccd10602ce1d89f814c0c995288e0d4e0fcd261e22fdacbb563ebf55db9a0f',
    'review.camera-polish-CFB-QG5J.js': '4517245afc1dbdd15b9b8c2a4d058a0ab833398b7a0fe50d65fcd528fb76e2be',
    'review.event-controls-DjbFTNtJ.js': '7e3ed7fe52989f13a65835a624451bd7dd9f831f36d5db822b21a1fb1ffc825a',
    'review.firebase-preflight-DFvBuToI.js': '948b768d7d87593cc9b52972727e33d0d3f94f97bb4a33b3d1acd6474946ec79',
    'review.injected-D4xSEh7r.js': '6051823b6d40dd108c971d0b56fdf2910875e53a26059da546c55996ee2e6c65',
    'review.kiosk-connected-DBVPj66T.js': 'f8d103dc64dadaf2c76b6aaa85cad1055b53687530a65259d478a190bf662151',
    'review.kiosk-setup-DlJQJ-4P.js': '93eba870ce167c80cbd501c7c4f367377039fe63b979392b2f2f37287bc46164',
    'review.north-star-CKQYTQs-.js': 'b5dce58b6baaa080e6afced820e380204499461d0356e1bb9b7a98933709f230',
    'review.north-star._state-BpklhoAA.js': 'da0510a6d8aed67d563539fe0ae8752547f8e901404602ccb0d6ae026e6616ab',
    'review.north-star.index-CH5SGmdD.js': 'cd001266d0afa80054f723df4da3613c5a70df3d856f121aba822ea781801e38',
    'review.overlay-latency-DWLjyOEN.js': '73b5cee66632e70257163d91d1558bf4875c0e65fc5b57286fc22c58745abad4',
    'review.pose-probe-nMWE_Dkx.js': 'd993ba78d12d43c27a0cf18d1414a00a982618aed625dafcdaa630f4eb968976',
    'routes-CFH8HQXz.js': '836674d8645aa27f2dfe88cde3133f6be71c2537dcaa6e8cdabb6a8fc80425fd',
    'share-preview-U9wOCtb3.js': '2b4ba27dece727460e123c6785bf357ed8fc7e5f2db6f1841756eb28a95ea681',
    'shell-Db9kvINk.js': '29529911bb2c39e9c50495fe11553016c4d1da975a406f481fdf2cc2eff231bb',
    'staging-diagnostics-BJGcZ8Tg.js': '5da9f7c4e8d7665e552978c343adb0f1fbdf18bfafbb5e4f69a28e81a6bfde5c',
    'staging-entry-EfYsDFhe.js': 'c4107ae4ca2ee44885ce2641e826aa2bdccd84823ec79aeb92fd683b72902407',
    'station-port-DFqHk9Pr.js': '5ee538a0c10554ec047c9a642b71d5e03cd666a258092e892ee39e2d09ae164a',
    'styles-8zOVnptZ.css': 'efba7cfee2910366bed33a9a97f93406966dc1831ce83be86a0f4317c4675341',
    'synthetic-motion-BgKcPyiF.js': 'cc298357d7ad80e59ffd1d71a5738eb2852eb140a3d47bcacd4007e33e647015',
    'terms-C5Fq_B8l.js': '8a1fc51c774232ec40bc6237235ae62db9a55a1936076bc75d274da3994b52d1',
    'tour-entry-DFxqT_cC.js': 'd6c689844b41a541cf056b0344c19ea30302c152bba941993a99f86c065f392e',
    'try-DjFwbKAL.js': 'c62960fece8ff194a3360a17da9a50ab1e3edefba165393020a2ea8b88a0b5d1',
    'use-wsf-FS1GsCZw.js': '11a7bb219257f7e8e7f7e05c57a5459f69477a74a7aa07ab00d09a36bb1d6e0c',
    'useSelector-w2QMMrCf.js': 'bb2e715c8755f7f8351b38ebf6df9bc00005e4ce7f27a119965712553b64079c',
    'user-plus-CKOU7WEU.js': '77790537731d79712d8408d0f1ebe6f80f290d67949a5885014f557e1390d2d8',
    'vision_bundle-PPA-e_wg.js': '27524e978f3f26fce66a0c20dcdb12eaa7445df7a391223ce31881ba89ae0541',
    'visualEstimator-C89l8ebk.js': '70e7c984cbf3cc20371ca1ece0bd2a533490d3e9b5fdeac5989886be87ccc009',
    'wordmark-navy-green.png.asset-Bksf2zD9.js': 'ddf11c329e0792224d07486b6f91931c78abb04c4ce86745280124fd347a23dd',
  }),
});
/**
 * The route templates the journeys load as documents: the kiosk proof `/` (also with an invite query) and
 * `/kiosk/<community>/<goal>`; the device matrix `/` (also with an invite query) and `/display/<goal>`. A document
 * for any other path is refused.
 */
export const ROUTE_TEMPLATES = Object.freeze(['/', '/display/$goalId', '/kiosk/$communityId/$goalId']);
/**
 * The documents the credential-free bind loads: `/` twice, `/` with an invite query, and each param template under two
 * different fixed probe ids (never a fixture's). The two ids differ in their first and last characters, their case and
 * their length, so a document that carries anything derived from an id other than the id itself cannot reduce to one
 * canonical form. Every load of one template must reduce to the same canonical document.
 */
export const BIND_PROBES = Object.freeze([
  '/',
  '/',
  '/?join=jn1-wsf-bind-probe&goal=ga1-wsf-bind-probe',
  '/display/ga1-wsf-bind-probe',
  '/display/Zq9wsfBindProbeGoal2',
  '/kiosk/ca1-wsf-bind-probe/ga1-wsf-bind-probe',
  '/kiosk/Xk4wsfBindProbeComm2/Zq9wsfBindProbeGoal2',
]);
/** At most this many assets are read when walking the served build. */
export const MAX_ASSETS = 150;
/**
 * The only other origins the journey's pages may reach, and only for data (xhr, fetch, eventsource), never for a
 * document or a script: Firebase Auth, Firestore and the staging callables.
 */
export const API_ORIGINS = Object.freeze([
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firestore.googleapis.com',
  `https://us-central1-${PROJECT_ID}.cloudfunctions.net`,
]);

export const ROWS = Object.freeze([
  ['host-build', 'the exact Lovable host serves exactly the reviewed canonical document of every route template and every reviewed asset digest, at bind AND for every document, script and stylesheet the browser loads; the host\'s own scripts are blocked; nothing else executable is loaded'],
  ['fixture-provenance', 'the event community, goal, Champion and visitors A and B are run-tagged kit fixtures in the cleanup manifest'],
  ['qr-join', 'visitor A, not a member, joins the event community through the kiosk QR link on the Lovable host'],
  ['queue-place', 'the visitor takes one place in the station line'],
  ['call', 'the station calls the visitor'],
  ['phone-ready', 'the visitor taps ready on the phone'],
  ['expected-turn-start', 'the station starts the expected turn'],
  ['round-60s', 'the 60-second round runs and writes nothing at timer end'],
  ['review', 'the station shows the round for review'],
  ['contribution-7', 'the phone control (the kit\'s verified member) sends exactly one wsfContribute for this goal with count 7 and a fresh attempt id'],
  ['operation-receipt', 'that request\'s own response: 7 added, alreadyRecorded false, an integer own credit and shared total in the goal\'s unit, and the screen shows exactly that total'],
  ['own-history-shared', 'fresh reads for the selected test goal: own credit up by exactly 7 and equal to the receipt, the shared total equal to the receipt, and the exact entry in the control\'s own history'],
  ['reopen-static', 'reopening MOVE on the same goal shows the recorded state and sends no second contribution'],
  ['account-isolation', 'control -> B -> control: B (a non-member) carries nothing of the control in context, own history or pending MOVE; the control returns in fresh storage with the same identity and the same record'],
  ['station-finish', 'station Finish leaves no previous visitor for the next one'],
  ['organizer-ui-approval', 'the Champion approves the kiosk code through the Manage community UI'],
  ['unverified-account', 'a genuinely unverified account joins and contributes'],
  ['cleanup-tracking', 'every product-written document (membership, contribution) is in the cleanup manifest before cleanup'],
].map(([id, expected]) => Object.freeze({ id, expected })));
const STATION_BLOCK = 'the safe station backend (#587, integrated in source) is not served on staging and this proof has no station driver yet; an older station path is never driven';
export const FIXED_BLOCKED = Object.freeze({
  'queue-place': STATION_BLOCK, call: STATION_BLOCK, 'phone-ready': STATION_BLOCK, 'expected-turn-start': STATION_BLOCK,
  'round-60s': STATION_BLOCK, review: STATION_BLOCK, 'station-finish': STATION_BLOCK,
  'unverified-account': 'the existing fixture kit creates verified accounts only (#396 6043231980); verification is never faked',
  'organizer-ui-approval': 'the station is approved through the kit\'s Champion callable as fixture preparation (tracked for cleanup); a UI approval would create a station record the kit cannot track',
});

const short = (e) => String(e?.message || e).split('\n')[0].replace(/[?&][A-Za-z]+=[^&\s"']+/g, '?…').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').slice(0, 200);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const idHash = (uid) => (typeof uid === 'string' && uid ? sha256(uid).slice(0, 16) : null);

/** The base URL, refused unless it is exactly the one allowed host. */
export function checkBase(raw) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.protocol !== 'https:' || u.origin !== LOVABLE_URL || !['', '/'].includes(u.pathname) || u.search || u.hash || u.username || u.password) {
    return { ok: false, reason: `not exactly ${LOVABLE_URL}` };
  }
  return { ok: true, base: LOVABLE_URL };
}

/** The route template a document path is, with the path's own params, or null for any other path. */
export function matchTemplate(pathname) {
  const segs = String(pathname).split('/').slice(1);
  for (const t of ROUTE_TEMPLATES) {
    if (t === '/') { if (pathname === '/') return { template: t, params: {} }; continue; }
    const ts = t.split('/').slice(1);
    if (ts.length !== segs.length) continue;
    const params = {};
    if (ts.every((s, i) => (s.startsWith('$') ? segs[i] !== '' && ((params[s.slice(1)] = segs[i]), true) : s === segs[i]))) return { template: t, params };
  }
  return null;
}

/** A path param the guard can bind: a fixture-shaped id, long enough that it cannot stand for other text in a document. */
const PARAM_RE = /^[A-Za-z0-9_-]{12,128}$/;
/** The host's context token: one quoted, token-shaped value, the attribute closed right after it. */
const TOKEN_RE = /data-context-token="([A-Za-z0-9._~:+/=-]{8,4096})"(?=[\s/>])/g;
const STREAM_OPEN_RE = /<script\b[^>]*?\sdata-tsr-stream-part(?=[\s=/>])[^>]*>/gi;
/** A `u:` key in the stream part (never the tail of another name such as `menu:`), with its value if that is 13 digits. */
const STREAM_U_RE = /(?<![A-Za-z0-9_$])u:(\d{13}(?!\d))?/g;
/**
 * The hosting's page-preview screenshot link (LOVABLE-REVIEWED-BUILD-2 step C; Lovable DEEPLINK-DRIFT-DIAG-1 and
 * CONFIRM-1, #394 6093458108 and 6093468966). Lovable's hosting adds it, as the og:image and twitter:image elements, to
 * a page that sets no preview image, and renames the file on each screenshot regeneration. Only the file name is a slot:
 * 32 lower-case hex digits, `_`, 13 digits, inside exactly this attribute (an attribute name of its own, the bucket host
 * and the `lovp_` segment literal). The file-name shape anywhere else is refused.
 */
const PREVIEW_IMAGE_RE = /(?<=\s)content="https:\/\/pub-bb2e103a32db4e198524a2e9ed8f35b4\.r2\.dev\/lovp_372ahwppkw9debd61922xf2ayz\/([0-9a-f]{32}_[0-9]{13})\.png"/g;
const PREVIEW_NAME_RE = /[0-9a-f]{32}_[0-9]{13}/g;
/** Valid UTF-8 only, and a leading BOM kept as a character, so it is a byte difference like any other (W3 R1). */
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/**
 * Which kinds of character a value carries outside a token's, for a refusal reason that never prints the value. A quote
 * cannot be among them: the first quote ends the value, and what follows it is judged as the end of the attribute.
 */
const outside = (v) => [[/[<>]/, 'angle bracket'], [/\s/, 'whitespace'], [/&/, 'ampersand'], [/[^A-Za-z0-9._~:+/=\-<>\s&]/, 'other']].filter(([re]) => re.test(v)).map(([, n]) => n);

/**
 * The canonical form of one served document for the URL it was served at, and its sha256, or why there is none
 * (HTML-VARIANCE-1, #365 6089082668 and 6089534129). Exactly two per-request values are normalized, each with a strict
 * count: the value of the host's one `data-context-token` attribute, and each `u:<13 digits>` inside the one
 * `data-tsr-stream-part` script. On a param template the hosting's preview screenshot file name is normalized too, in
 * exactly two links naming the same file (none on `/`; step C). Then each of the URL's own path params is put back into
 * its template slot. Every
 * other byte is kept, so any other difference (a script, an attribute, route data, a per-request value elsewhere)
 * changes the digest. The form is a list of literal text and slots, hashed as JSON, so no byte of a document (a NUL
 * included) can stand for a slot. Nothing returned carries the token's value.
 */
export function canonicalDocument(text, url) {
  let u;
  try { u = new URL(url); } catch { return { reason: 'an unreadable URL' }; }
  const m = matchTemplate(u.pathname);
  if (!m) return { reason: `${u.pathname} is not a reviewed route template` };
  const fail = (reason) => ({ template: m.template, reason });
  const params = Object.entries(m.params);
  if (params.some(([, v]) => !PARAM_RE.test(v))) return fail('a path param the guard cannot bind (it must be 12-128 of A-Z, a-z, 0-9, _ and -)');
  if (params.some(([, v], i) => params.some(([, w], j) => i !== j && w.includes(v)))) return fail('two path params overlap');
  const doc = String(text);
  const cuts = []; // [start, end, slot]: the byte ranges a slot replaces
  // 1. The host's context token: exactly one attribute, with exactly one token-shaped value.
  const attrs = doc.split('data-context-token=').length - 1;
  if (attrs !== 1) return fail(`${attrs} data-context-token attributes, not exactly 1`);
  const tokens = [...doc.matchAll(TOKEN_RE)];
  if (tokens.length !== 1) {
    const raw = /data-context-token=("?)([^]{0,4097}?)(?:"|$)/.exec(doc);
    const bad = raw?.[1] === '"' ? outside(raw[2]) : ['no opening quote'];
    return fail(`the data-context-token value is not one quoted token closed by the end of its attribute (${bad.length ? bad.join(', ') : 'the attribute is not closed after the value, or the value is not 8-4096 characters'})`);
  }
  const at = tokens[0].index + 'data-context-token="'.length;
  cuts.push([at, at + tokens[0][1].length, 'token']);
  // 2. TanStack's stream part: exactly one script, and every u: in it is 13 digits.
  const opens = [...doc.matchAll(STREAM_OPEN_RE)];
  if (opens.length !== 1) return fail(`${opens.length} data-tsr-stream-part scripts, not exactly 1`);
  const start = opens[0].index + opens[0][0].length;
  const close = /<\/script/gi; // searched in the document itself: lower-casing can change a string's length
  close.lastIndex = start;
  const end = close.exec(doc)?.index ?? -1;
  if (end < 0) return fail('the data-tsr-stream-part script is not closed');
  if (at >= start && at < end) return fail('the data-context-token attribute is inside the stream part');
  let streamU = 0;
  let nonDigit = 0;
  for (const x of doc.slice(start, end).matchAll(STREAM_U_RE)) {
    streamU += 1;
    if (!x[1]) nonDigit += 1; else cuts.push([start + x.index + 2, start + x.index + 2 + 13, 'u']);
  }
  if (nonDigit) return fail(`${nonDigit} of the ${streamU} u: values in the stream part are not 13 digits`);
  if (!streamU) return fail('the stream part carries no u: value');
  // 3. The hosting's preview screenshot (step C): exactly two links on a param template, none on `/`, outside the stream
  //    part, both naming the same file; the file-name shape nowhere else. Only the file name is cut.
  const shots = [...doc.matchAll(PREVIEW_IMAGE_RE)];
  const wantShots = params.length ? 2 : 0;
  if (shots.length !== wantShots) return fail(`${shots.length} hosting preview-image link(s), not exactly ${wantShots}`);
  const shapes = doc.match(PREVIEW_NAME_RE)?.length ?? 0;
  if (shapes !== shots.length) return fail(`the preview-image file-name shape appears ${shapes - shots.length} time(s) outside the preview-image links`);
  if (shots.some((x) => x.index >= start && x.index < end)) return fail('a preview-image link is inside the stream part');
  const previewImages = [...new Set(shots.map((x) => x[1]))];
  if (previewImages.length > 1) return fail('the two preview-image links name different files');
  for (const x of shots) { const at = x.index + x[0].length - '.png"'.length - x[1].length; cuts.push([at, at + x[1].length, 'preview-image']); }
  // NUL characters are document bytes (the real host's documents carry them): kept, counted, and classed by context.
  const nulIn = (a, b) => doc.slice(a, b).split('\u0000').length - 1;
  const nul = nulIn(0, doc.length);
  let inScript = 0;
  for (const x of doc.matchAll(/<script\b[^>]*>/gi)) {
    if (/\ssrc=/i.test(x[0]) || x.index === opens[0].index) continue;
    const from = x.index + x[0].length;
    const shut = /<\/script/gi;
    shut.lastIndex = from;
    inScript += nulIn(from, shut.exec(doc)?.index ?? doc.length);
  }
  const nulClasses = { stream: nulIn(start, end), script: inScript, markup: 0 };
  nulClasses.markup = nul - nulClasses.stream - nulClasses.script;
  // 4. Literal text between the cuts, then the URL's own params, longest first, as slots in the literal text only.
  let parts = [];
  let from = 0;
  for (const [a, b, slot] of cuts.sort((x, y) => x[0] - y[0])) { parts.push(doc.slice(from, a), { slot }); from = b; }
  parts.push(doc.slice(from));
  const counts = {};
  for (const [name, v] of [...params].sort((x, y) => y[1].length - x[1].length)) {
    counts[name] = 0;
    parts = parts.flatMap((p) => {
      if (typeof p !== 'string') return [p];
      const pieces = p.split(v);
      counts[name] += pieces.length - 1;
      return pieces.flatMap((q, i) => (i ? [{ slot: `param:${name}` }, q] : [q]));
    });
  }
  return { template: m.template, sha256: sha256(Buffer.from(JSON.stringify(parts), 'utf8')), streamU, nul, nulClasses, img: shots.length, previewImages, params: counts, bom: doc.charCodeAt(0) === 0xfeff };
}

/**
 * Why a document's declared type is refused, or null. It must be text/html, with no charset or with UTF-8 only, so the
 * browser decodes exactly the text the guard canonicalized (L0 R7, #394 6092214109); the guard also fulfils every
 * verified document with an explicit UTF-8 charset.
 */
export function documentTypeProblem(contentType) {
  const t = String(contentType ?? '').trim();
  if (!/^text\/html\s*(;|$)/i.test(t)) return `served as ${t ? 'another content type' : 'no content type'}, not text/html`;
  return charsetProblem(t);
}
/** Why a declared charset is refused, or null: none, or exactly one charset parameter (any case) that is UTF-8. */
function charsetProblem(t) {
  const sets = [...t.matchAll(/;\s*charset\s*=\s*"?([^";\s]*)"?/gi)].map((x) => x[1].toLowerCase());
  if (sets.length > 1 || (sets.length === 1 && !['utf-8', 'utf8'].includes(sets[0]))) return `served with charset ${sets.join(', ')}, not UTF-8`;
  return null;
}
/**
 * Why a reviewed asset's declared type is refused, or null (LOVABLE-REVIEWED-BUILD-2, queue #365 6092691424): a script
 * or stylesheet declared in a charset other than UTF-8 is refused, at bind and in the guard, and a verified asset keeps
 * the host's own headers. Refused rather than relabelled: relabelling would make the run's browser decode the asset
 * differently from a visitor's, so a host-side charset change would pass host-build while the product broke for the
 * people using it. In every admitted case the encoding is fixed by reviewed input, never by an unverified header: UTF-8
 * unless the reviewed bytes (a BOM or @charset) or the reviewed document say otherwise (a module script is always
 * UTF-8; W3 N1). The MIME type is left to the browser's own checks, which treat this run as they treat a visitor.
 */
export const assetTypeProblem = (contentType) => charsetProblem(String(contentType ?? '').trim());
/** The content type every verified document is fulfilled with (L0 R7). */
const DOCUMENT_TYPE = 'text/html; charset=utf-8';

/** The script and stylesheet references a document itself makes (src of a script; href of a stylesheet or modulepreload link). */
function tagRefs(html) {
  const out = [];
  for (const [, a] of html.matchAll(/<script\b([^>]*)>/gi)) { const src = /\ssrc=["']([^"']*)["']/i.exec(a)?.[1]; if (src !== undefined) out.push([src, 'script']); }
  for (const [, a] of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = (/\srel=["']([^"']*)["']/i.exec(a)?.[1] ?? '').toLowerCase().split(/\s+/);
    const href = /\shref=["']([^"']*)["']/i.exec(a)?.[1];
    if (href === undefined) continue;
    if (rel.includes('stylesheet')) out.push([href, 'stylesheet']);
    else if (rel.includes('modulepreload')) out.push([href, 'script']);
    else if (rel.includes('preload') && /\sas=["']?(script|style)/i.test(a)) out.push([href, /\sas=["']?script/i.test(a) ? 'script' : 'stylesheet']);
  }
  return out;
}

/**
 * The served build: each route template's canonical document, from every BIND_PROBES load of it, and every same-origin
 * asset the documents load, by name, with the sha256 of its bytes. Bounded; never follows another origin. A template
 * whose loads reduce to different canonical documents stays unbound (sha256 null) and the bind fails; the reference
 * check names every document reference the code guard would refuse.
 */
export async function servedManifest(fetchImpl, base = LOVABLE_URL) {
  const get = async (p) => {
    const res = await fetchImpl(`${base}${p}`, { redirect: 'error', headers: { 'user-agent': 'wsf-lovable-kiosk-bind' } });
    if (!res.ok) throw new Error(`${p.split('?')[0]} answered HTTP ${res.status}`);
    return { body: Buffer.from(await res.arrayBuffer()), type: res.headers?.get?.('content-type') ?? null };
  };
  // Same-origin references only: `assets/x.js` or `/assets/x.js` right after a quote, parenthesis or space (never the
  // path inside another origin's URL), and, inside a chunk, Vite's sibling imports `./x.js` (which live in /assets/).
  const refs = (text, inChunk = false) => [
    ...[...text.matchAll(/(?:^|["'(\s])\/?(assets\/[A-Za-z0-9_.-]+\.(?:js|css))/g)].map((m) => `/${m[1]}`),
    ...(inChunk ? [...text.matchAll(/["']\.\/([A-Za-z0-9_.-]+\.(?:js|css))["']/g)].map((m) => `/assets/${m[1]}`) : []),
  ];
  const probes = [];
  const queue = [];
  const tags = [];
  const assetRefusals = [];
  for (const p of BIND_PROBES) {
    const { body, type } = await get(p);
    const typeProblem = documentTypeProblem(type);
    let text = null;
    try { text = UTF8.decode(body); } catch { /* not UTF-8: refused below, never canonicalized */ }
    probes.push({ path: p, ...(typeProblem ? { reason: `the document is ${typeProblem}` } : text === null ? { reason: 'the document is not valid UTF-8' } : canonicalDocument(text, `${base}${p}`)) });
    if (text === null) continue;
    for (const r of refs(text)) if (!queue.includes(r)) queue.push(r);
    for (const [ref, type] of tagRefs(text)) tags.push({ url: new URL(ref, `${base}${p}`).href, type });
  }
  const documents = {};
  for (const t of ROUTE_TEMPLATES) {
    const of = probes.filter((x) => matchTemplate(new URL(`${base}${x.path}`).pathname)?.template === t);
    const forms = new Set(of.map((x) => (x.sha256 ? `${x.sha256} ${x.streamU} ${x.nul} ${x.img}` : null)));
    documents[t] = of.length && of.every((x) => x.sha256) && forms.size === 1
      ? { sha256: of[0].sha256, streamU: of[0].streamU, nul: of[0].nul, img: of[0].img, nulClasses: of[0].nulClasses, bom: of[0].bom, previewImages: [...new Set(of.flatMap((x) => x.previewImages))] }
      : { sha256: null, streamU: null, nul: null, reason: of.find((x) => !x.sha256)?.reason ?? `its ${of.length} loads reduce to ${forms.size} different canonical documents (route data beyond the URL's own params, or a per-request value outside the two normalized ones)` };
  }
  const assets = {};
  while (queue.length) {
    const p = queue.shift();
    const name = p.slice('/assets/'.length);
    if (Object.hasOwn(assets, name)) continue;
    if (Object.keys(assets).length >= MAX_ASSETS) throw new Error(`more than ${MAX_ASSETS} assets; refusing a partial manifest`);
    const { body, type } = await get(p);
    assets[name] = sha256(body);
    const typeProblem = assetTypeProblem(type);
    if (typeProblem) assetRefusals.push(`${p.endsWith('.css') ? 'stylesheet' : 'script'} ${base}${p} is ${typeProblem}`);
    if (p.endsWith('.js')) for (const r of refs(body.toString('utf8'), true)) if (!Object.hasOwn(assets, r.slice(8)) && !queue.includes(r)) queue.push(r);
  }
  if (!Object.keys(assets).length) throw new Error('the served documents name no asset');
  const classified = tags.map((x) => classifyRequest({ ...x, navigation: false }, { documents: {}, assets }));
  const refusals = [...new Set([...classified.filter((c) => c.action === 'abort').map((c) => c.reason), ...assetRefusals])];
  const blocked = [...new Set(classified.filter((c) => c.action === 'block').map((c) => c.what))];
  return { documents, assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => (a < b ? -1 : 1))), probes, refusals, blocked };
}

const pinnedDocument = (d) => /^[0-9a-f]{64}$/.test(String(d?.sha256)) && Number.isInteger(d?.streamU) && d.streamU > 0 && Number.isInteger(d?.nul) && d.nul >= 0 && Number.isInteger(d?.img) && d.img >= 0;
/** The observed build against the reviewed one: PASS only on the same canonical documents, the same asset names with the same digests, and no document reference the guard would refuse. */
export function bindBuild(observed, reviewed = REVIEWED_BUILD) {
  const want = reviewed?.assets ?? {};
  const docs = reviewed?.documents ?? {};
  if (!Object.keys(want).length || !ROUTE_TEMPLATES.every((t) => pinnedDocument(docs[t]))) return { status: 'BLOCKED', reason: 'no reviewed build is pinned yet (REVIEWED_BUILD needs a canonical document, with its u:, NUL and preview-image counts, for every route template, and every asset)' };
  const changedDocs = ROUTE_TEMPLATES.filter((t) => observed?.documents?.[t]?.sha256 !== docs[t].sha256 || observed.documents[t].streamU !== docs[t].streamU || observed.documents[t].nul !== docs[t].nul || observed.documents[t].img !== docs[t].img);
  if (changedDocs.length) return { status: 'FAIL', reason: `the served ${changedDocs.join(', ')} document${changedDocs.length > 1 ? 's differ' : ' differs'} from the reviewed one (inline or loaded executable content, route data or a per-request value changed)` };
  const got = observed?.assets ?? {};
  const missing = Object.keys(want).filter((n) => !Object.hasOwn(got, n));
  const extra = Object.keys(got).filter((n) => !Object.hasOwn(want, n));
  const changed = Object.keys(want).filter((n) => Object.hasOwn(got, n) && got[n] !== want[n]);
  if (missing.length || extra.length || changed.length) {
    return { status: 'FAIL', reason: `the served build differs from the reviewed one: ${missing.length} missing, ${extra.length} unreviewed, ${changed.length} changed (${[...missing, ...extra, ...changed].slice(0, 5).join(', ')})` };
  }
  if (!Array.isArray(observed?.refusals) || observed.refusals.length) return { status: 'FAIL', reason: `the documents load ${observed?.refusals?.length ?? 'unchecked'} reference(s) the code guard would refuse${observed?.refusals?.length ? ` (${observed.refusals.slice(0, 3).join('; ')})` : ''}` };
  return { status: 'PASS', reason: `${ROUTE_TEMPLATES.length} reviewed route documents and ${Object.keys(want).length} reviewed assets served exactly` };
}

/**
 * The lines a bind prints: the verdict, each template's canonical document, each probe load, any reference the guard
 * would refuse, each host script it would block, each asset, and, when every template is bound, the whole manifest as
 * one JSON line to pin. Templates,
 * fixed probe paths, names, counts, digests and whether a document starts with a BOM (`bom=yes|no`, which the digest
 * already binds; printed so a changed digest can be told apart from a BOM, run 38017456574) only: never a document's
 * bytes or the token's value. Each template's line also names the preview screenshot files its loads carried (public,
 * printed only in the checked shape, never in the line to pin), so two samples show a regeneration being absorbed.
 */
const nulWhere = (c) => (c && (c.stream || c.script || c.markup) ? ` (stream part ${c.stream}, other inline script ${c.script}, markup ${c.markup})` : '');
const bomFlag = (d) => ` bom=${d.bom ? 'yes' : 'no'}`;
/** The observed preview screenshot file names (public: every visitor gets them), printed only in the checked shape. */
const PREVIEW_NAME = /^[0-9a-f]{32}_[0-9]{13}$/;
const previewNames = (d) => { const n = (d.previewImages ?? []).filter((x) => PREVIEW_NAME.test(x)); return n.length ? ` preview-image=${n.join(',')}` : ''; };
export function bindLines(observed, verdict) {
  const lines = [`LOVABLE_BUILD=${verdict.status} (${verdict.reason})`];
  if (!observed) return lines;
  for (const t of ROUTE_TEMPLATES) {
    const d = observed.documents?.[t];
    lines.push(d?.sha256 ? `LOVABLE_OBSERVED_DOCUMENT ${t} ${d.sha256} u=${d.streamU} nul=${d.nul}${nulWhere(d.nulClasses)} img=${d.img}${bomFlag(d)}${previewNames(d)}` : `LOVABLE_OBSERVED_DOCUMENT ${t} UNBOUND (${d?.reason ?? 'not loaded'})`);
  }
  for (const p of observed.probes ?? []) {
    const where = `${String(p.path).split('?')[0]}${String(p.path).includes('?') ? ' (with an invite query)' : ''}`;
    lines.push(`LOVABLE_DOCUMENT_PROBE ${where} ${p.sha256 ? `${p.template} ${p.sha256} u=${p.streamU} nul=${p.nul}${nulWhere(p.nulClasses)} img=${p.img}${bomFlag(p)} params=${JSON.stringify(p.params)}` : `refused (${p.reason})`}`);
  }
  for (const r of observed.refusals ?? []) lines.push(`LOVABLE_DOCUMENT_REFUSED_REFERENCE ${r}`);
  for (const w of observed.blocked ?? []) lines.push(`LOVABLE_DOCUMENT_BLOCKED_HOST_SCRIPT ${w}`);
  for (const [n, d] of Object.entries(observed.assets ?? {})) lines.push(`LOVABLE_OBSERVED_ASSET ${n} ${d}`);
  if (ROUTE_TEMPLATES.every((t) => pinnedDocument(observed.documents?.[t]))) {
    lines.push(`LOVABLE_OBSERVED_BUILD ${JSON.stringify({ documents: Object.fromEntries(ROUTE_TEMPLATES.map((t) => [t, { sha256: observed.documents[t].sha256, streamU: observed.documents[t].streamU, nul: observed.documents[t].nul, img: observed.documents[t].img }])), assets: observed.assets })}`);
  }
  return lines;
}

const PASSIVE_TYPES = new Set(['image', 'font', 'media', 'manifest', 'texttrack', 'xhr', 'fetch', 'eventsource']);
const DATA_TYPES = new Set(['xhr', 'fetch', 'eventsource']);
/**
 * The Lovable host's own injected scripts, never the app's: the events script whose tag carries the context token, and
 * `/~flock.js` (seen in the documents by the bind of run 38006215259). The app reaches them only through optional calls
 * (`window.__lovableEvents?.…`), so they are blocked: never fetched or run, and never a refusal (Director ruling #394
 * 6091249662). Exact, anchored paths on the Lovable host, with no query or fragment, not even an empty one (the URL is
 * exactly origin + path), and no userinfo, scripts only; anything else is refused. The events id is exactly the real
 * one's shape, 16 lower-case hex digits (`/__l5e/events.1718a1eacac7ff3a.js` in bind runs 38007859514, 38017456574 and 38018743683;
 * LOVABLE-REVIEWED-BUILD-2, #394 6092810294), so no other name in that directory is blocked.
 */
const HOST_SCRIPTS = Object.freeze([/^\/__l5e\/events\.[0-9a-f]{16}\.js$/, /^\/~flock\.js$/]);
/**
 * What the browser may load (#589 W9 finding #497 6051520120: the digest must bind what EXECUTES, not a neighbouring
 * fetch). On the Lovable host: every document (each navigation, deep links included) must be a reviewed route template
 * and is verified against that template's reviewed canonical document; every script or stylesheet must be a reviewed
 * /assets/ file with its reviewed digest, except the host's own injected scripts, which are blocked and never run;
 * passive types pass. Elsewhere: only data requests to API_ORIGINS pass. Everything else that reaches the route is
 * refused (a WebSocket handshake and the redirect hops of a continued request never reach it). `what` never carries a
 * query.
 */
export function classifyRequest({ url, type, navigation }, reviewed = REVIEWED_BUILD) {
  let u;
  try { u = new URL(url); } catch { return { action: 'abort', reason: `${type} with an unreadable URL` }; }
  const what = `${type} ${u.origin}${u.pathname}`;
  if (u.origin === LOVABLE_URL) {
    // A URL with userinfo is never a reviewed request; `what` never carries the userinfo itself (#394 6092810294 item 7).
    if (u.username || u.password) return { action: 'abort', reason: `${what} carries userinfo (not printed), which no reviewed request has` };
    if (navigation || type === 'document') {
      const m = matchTemplate(u.pathname);
      return m ? { action: 'verify', kind: 'document', template: m.template, want: reviewed?.documents?.[m.template] ?? null, what } : { action: 'abort', reason: `${what} is not a reviewed route template` };
    }
    if (type === 'script' || type === 'stylesheet') {
      if (type === 'script' && u.href === `${u.origin}${u.pathname}` && HOST_SCRIPTS.some((re) => re.test(u.pathname))) return { action: 'block', what };
      const name = /^\/assets\/([A-Za-z0-9_.-]+)$/.exec(u.pathname)?.[1];
      return name && Object.hasOwn(reviewed?.assets ?? {}, name) ? { action: 'verify', kind: 'asset', want: reviewed.assets[name], what } : { action: 'abort', reason: `${what} is not a reviewed asset` };
    }
    return PASSIVE_TYPES.has(type) ? { action: 'continue', what } : { action: 'abort', reason: `${what} is not a permitted resource type` };
  }
  if (API_ORIGINS.includes(u.origin) && !navigation && DATA_TYPES.has(type)) return { action: 'continue', what };
  return { action: 'abort', reason: `${what} is outside the reviewed build and the permitted API origins` };
}

/**
 * The served-code guard, routed on EVERY browser context of the journey (service workers blocked, so none can answer
 * around it; Playwright routes every request but a WebSocket handshake and the redirect hops of a continued request,
 * which carry data, never code). A verified response is fetched once and fulfilled with exactly the bytes read: an asset
 * only when it is declared with no charset or UTF-8 and those bytes carry its reviewed digest (it keeps the host's own
 * headers), a document only when it is served as text/html with no charset or UTF-8,
 * its bytes are valid UTF-8 (a BOM kept), and they reduce, for the URL requested, to its template's reviewed canonical
 * document with the reviewed numbers of stream-part timestamps, NULs and preview-image links. A redirect, an error
 * status, other bytes, an unreviewed or foreign script or document is aborted and recorded; a document is fulfilled with
 * an explicit UTF-8 charset, so the browser decodes the text that was verified; a host script is
 * aborted and counted as blocked. `check()` throws once anything was refused, so the journey stops before the next step
 * (a sign-in included).
 */
export function codeGuard(reviewed = REVIEWED_BUILD) {
  const violations = [];
  const blocked = [];
  let verified = 0;
  async function handle(route) {
    const req = route.request();
    const c = classifyRequest({ url: req.url(), type: req.resourceType(), navigation: req.isNavigationRequest() }, reviewed);
    const refuse = async (reason) => { violations.push(reason); try { await route.abort('blockedbyclient'); } catch { /* the page may be gone */ } };
    if (c.action === 'continue') { try { await route.continue(); } catch { /* the page may be gone */ } return; }
    if (c.action === 'block') { blocked.push(c.what); try { await route.abort('blockedbyclient'); } catch { /* the page may be gone */ } return; }
    if (c.action === 'abort') { await refuse(c.reason); return; }
    if (c.kind === 'document' ? !pinnedDocument(c.want) : !/^[0-9a-f]{64}$/.test(String(c.want))) { await refuse(`${c.what}: no reviewed ${c.kind === 'document' ? `${c.template} document` : 'digest'} is pinned`); return; }
    let res;
    let body;
    try { res = await route.fetch({ maxRedirects: 0 }); body = await res.body(); } catch (e) { await refuse(`${c.what} could not be read: ${short(e)}`); return; }
    if (res.status() !== 200) { await refuse(`${c.what} answered HTTP ${res.status()}, not the reviewed file`); return; }
    if (c.kind === 'document') {
      const typeProblem = documentTypeProblem(res.headers()['content-type']);
      if (typeProblem) { await refuse(`${c.what} is ${typeProblem}`); return; }
      let text;
      try { text = UTF8.decode(body); } catch { await refuse(`${c.what} is not valid UTF-8`); return; }
      const d = canonicalDocument(text, req.url());
      if (!d.sha256) { await refuse(`${c.what}: ${d.reason}`); return; }
      if (d.template !== c.template || d.streamU !== c.want.streamU) { await refuse(`${c.what} carries ${d.streamU} stream-part u: value(s), not the reviewed ${c.want.streamU}`); return; }
      if (d.nul !== c.want.nul) { await refuse(`${c.what} carries ${d.nul} NUL character(s), not the reviewed ${c.want.nul}`); return; }
      if (d.img !== c.want.img) { await refuse(`${c.what} carries ${d.img} preview-image link(s), not the reviewed ${c.want.img}`); return; }
      if (d.sha256 !== c.want.sha256) { await refuse(`${c.what} differs from the reviewed ${c.template} document`); return; }
    } else {
      const typeProblem = assetTypeProblem(res.headers()['content-type']);
      if (typeProblem) { await refuse(`${c.what} is ${typeProblem}`); return; }
      if (sha256(body) !== c.want) { await refuse(`${c.what} differs from its reviewed digest`); return; }
    }
    verified += 1;
    const headers = c.kind === 'document' ? { ...res.headers(), 'content-type': DOCUMENT_TYPE } : undefined;
    try { await route.fulfill({ response: res, body, ...(headers ? { headers } : {}) }); } catch { /* the page may be gone */ }
  }
  return {
    handle,
    check() { if (violations.length) throw new Error(`the browser was served code outside the reviewed build: ${violations[0]}`); },
    summary: () => ({ verified, violations: [...violations], blocked: [...blocked] }),
  };
}

/** The host-build row: PASS only when the bind matched AND the browser executed only verified documents and assets. */
export function hostBuildRow(bind, served) {
  if (bind?.status !== 'PASS') return { status: bind?.status ?? 'FAIL', seen: bind?.reason ?? 'no bind verdict' };
  if (served?.violations?.length) return { status: 'FAIL', seen: `bind matched, but the browser was served ${served.violations.length} unreviewed request(s): ${served.violations.slice(0, 3).join('; ')}` };
  if (!(served?.verified > 0)) return { status: 'FAIL', seen: 'bind matched, but the browser loaded no verified document' };
  return { status: 'PASS', seen: `bind matched; ${served.verified} document/asset response(s) the browser loaded matched their reviewed digests; ${served.blocked?.length ?? 0} host script request(s) blocked, not run; nothing else executable was loaded` };
}

/** A --run's results: the journey's rows and the CLI's own, with host-build always from the bind AND what the browser was served. */
export function runResults(bind, journey, rows = {}) {
  return results({ ...journey?.rows, ...rows, 'host-build': hostBuildRow(bind, journey?.served) });
}

/** The browser's environment: the runner's, without any cloud or workflow credential (defence in depth; #589 W9 N2). */
export function browserEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^(WSF_GOOGLE_|GOOGLE_|CLOUDSDK_|ACTIONS_ID_TOKEN_REQUEST_|ACTIONS_RUNTIME_|GITHUB_TOKEN$|GH_TOKEN$)/.test(k)));
}

/** The results document: every row, in order, with its status and what was seen. */
export function results(rows, extra = {}) {
  const out = ROWS.map(({ id, expected }) => {
    const r = rows[id] ?? (FIXED_BLOCKED[id] ? { status: 'BLOCKED', seen: FIXED_BLOCKED[id] } : { status: 'BLOCKED', seen: 'not reached' });
    return { id, expected, status: r.status, seen: short(r.seen ?? '') };
  });
  return { schemaVersion: 1, host: LOVABLE_URL, project: PROJECT_ID, rows: out, ...extra };
}
export const allPassed = (doc) => Array.isArray(doc?.rows) && doc.rows.length === ROWS.length && doc.rows.every((r) => r.status === 'PASS');

/** Does `text` show the whole number `n` (en-US grouping or none), not merely contain its digits? */
export function showsNumber(text, n) {
  if (!Number.isInteger(n)) return false;
  const t = String(text ?? '');
  return [n.toLocaleString('en-US'), String(n)].some((f) => new RegExp(`(^|[^\\d,.])${f.replace(/[,.]/g, '\\$&')}(?![\\d,.]*\\d)`).test(t));
}

/**
 * The receipt row from ONE paired callable exchange: the wsfContribute REQUEST this page sent (goalId, attemptId,
 * count) and that request's own RESPONSE (addedCount, ownCredit, alreadyRecorded, sharedTotal, target, unit, status,
 * crossedTarget). The attempt and goal come from the request; nothing is read from a field the response never has.
 */
export function receiptVerdict(exchange, { goalId, amount, unit, screenText }) {
  const q = exchange?.data ?? {};
  const r = exchange?.result;
  const okReq = q.goalId === goalId && q.count === amount && typeof q.attemptId === 'string' && q.attemptId !== '';
  const okRes = !!r && typeof r === 'object' && r.addedCount === amount && r.alreadyRecorded === false
    && Number.isInteger(r.ownCredit) && Number.isInteger(r.sharedTotal) && r.unit === unit;
  const okScreen = okRes && showsNumber(screenText, r.sharedTotal) && String(screenText ?? '').includes(unit);
  return {
    ok: okReq && okRes && okScreen, attemptId: okReq ? q.attemptId : null,
    shared: okRes ? r.sharedTotal : null, ownCredit: okRes ? r.ownCredit : null,
    seen: `request ${okReq ? 'this goal, count ' + amount + ', an attempt' : 'not this goal/count/attempt'}; response addedCount=${r?.addedCount} alreadyRecorded=${r?.alreadyRecorded} unit=${r?.unit === unit ? 'the goal unit' : 'other'} shared=${r?.sharedTotal}; screen ${okScreen ? 'shows exactly that total' : 'does not show exactly that total'}`,
  };
}

/** The selected-goal own credit from a paired wsfMyContribution exchange, or null (never 0 by default). */
export const ownCreditOf = (exchange, goalId) => (exchange?.data?.goalId === goalId && Number.isInteger(exchange?.result?.ownCredit) ? exchange.result.ownCredit : null);
/** The selected-goal shared total from a paired wsfGoalPulse exchange, or null. */
export const sharedOf = (exchange, goalId) => (exchange?.data?.goalId === goalId && Number.isInteger(exchange?.result?.sharedTotal) ? exchange.result.sharedTotal : null);

/**
 * Every wsf* callable this page sends, each REQUEST paired with its own RESPONSE by Playwright's request identity.
 * `onResult(exchange)` runs as each response is decoded, so cleanup tracking never depends on a later assertion.
 * Bodies stay in memory; nothing here is written or logged.
 */
export function callableLog(page, onResult = () => {}) {
  const all = [];
  page.on('request', (req) => {
    let name;
    try { name = /\/(wsf[A-Za-z]+)$/.exec(new URL(req.url()).pathname)?.[1]; } catch { name = null; }
    if (!name || req.method() !== 'POST') return;
    let data = null;
    try { data = JSON.parse(req.postData() || '{}')?.data ?? null; } catch { data = null; }
    all.push({ name, req, data, result: undefined, error: null });
  });
  page.on('response', async (res) => {
    const e = all.find((x) => x.req === res.request());
    if (!e) return;
    try { const b = await res.json(); e.result = b?.result ?? null; e.error = b?.error?.status ?? null; } catch { e.result = null; e.error = 'unreadable'; }
    try { onResult(e); } catch { /* tracking failures surface through the cleanup-tracking row */ }
  });
  const of = (name, goalId) => all.filter((x) => x.name === name && (goalId === undefined || x.data?.goalId === goalId));
  return { of, last: (name, goalId) => of(name, goalId).filter((x) => x.result !== undefined).at(-1) ?? null, sent: (name, goalId) => of(name, goalId).length };
}

/** The product-written documents this run must clean up, added to the kit's manifest after its last write. Run-tagged paths only. */
export function mergeIntoManifest(file, docs) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bad = docs.filter((d) => typeof d !== 'string' || !d.includes(m.runTag) || d.includes('..') || d.startsWith('/'));
  if (bad.length) throw new Error(`refusing ${bad.length} untagged cleanup path(s)`);
  m.docs = [...new Set([...(m.docs ?? []), ...docs])];
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  return m.docs.length;
}

// ---- the browser journey ----------------------------------------------------------------------
// Selectors and flow are the connected Lovable app's own (src/wsf/kiosk/*, src/demo/move.tsx, together.tsx, shell),
// read at the donor project's HEAD; nothing here is a guess the page cannot confirm.
const PHONE = { width: 390, height: 844 };
const GOAL_TITLE = 'Fixture Expo Squats';
const COMMUNITY = 'Fixture Expo Community';
const UNIT = 'squats';
/** How the phone rows name who measured them: the kit's verified member, made as fixture preparation. */
const CONTROL = 'control (the kit\'s verified member)';
/** qr-join with the existing kit: its communities are private, and the served backend gives a private community no join code. */
const QR_KIT_BLOCK = 'the kiosk shows no join code: the existing kit makes only private communities (joinPolicy private), and the served backend gives a private community no newcomer QR; a link-joinable fixture needs a kit change outside this packet';

/** The signed-in Firebase uid of this page: IndexedDB persistence first (the SDK default), then localStorage. */
async function uidOf(page) {
  return page.evaluate(async () => {
    try {
      const rows = await new Promise((resolve) => {
        const open = indexedDB.open('firebaseLocalStorageDb');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          try {
            const req = open.result.transaction('firebaseLocalStorage', 'readonly').objectStore('firebaseLocalStorage').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch { resolve([]); }
        };
      });
      for (const r of rows) if (r?.value?.uid) return r.value.uid;
    } catch { /* fall through */ }
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('firebase:authUser')) { try { return JSON.parse(localStorage.getItem(k)).uid || null; } catch { /* next */ } }
    }
    return null;
  });
}
const visible = async (loc) => (await loc.count()) > 0;
/** The first-run tour can open over Home; its own Skip closes it, so later name-based clicks reach the product. */
async function skipTour(page) {
  const skip = page.getByRole('button', { name: 'Skip tour' });
  if (await visible(skip)) await skip.first().click();
}
async function signIn(page, account) {
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(6000);
}
async function signOut(page) {
  await page.getByRole('button', { name: 'Open menu' }).first().click();
  await page.getByRole('button', { name: /^Sign out/ }).first().click();
  await page.waitForTimeout(3000);
}
/** The test community, chosen explicitly when the account belongs to several and none is remembered. */
async function chooseCommunity(page) {
  const nav = page.getByRole('navigation', { name: 'Your communities' });
  if (await visible(nav)) await nav.getByRole('button', { name: new RegExp(`^${COMMUNITY}`) }).first().click();
  await page.waitForTimeout(4000);
  await skipTour(page);
}
/** The Progress tab's row for the test goal: its exact own and shared text, or null. */
async function progressRow(page) {
  await page.locator('[data-tab="progress"]').first().click();
  await page.waitForTimeout(2000);
  const row = page.locator('ul.goal-history li').filter({ hasText: GOAL_TITLE });
  return (await visible(row)) ? (await row.first().innerText()).replace(/\s+/g, ' ') : null;
}
/** Leave MOVE's camera or instructions step for the count step (start mode on a squats goal opens the camera). */
async function toCountStep(page) {
  for (const name of ['Count by hand instead', 'Enter reps manually', 'I’m done — enter my count']) {
    const b = page.getByRole('button', { name });
    if (await visible(b)) { await b.first().click(); break; }
  }
}

/**
 * The journey. `fixtures` is the existing kit; every row it reaches is recorded; product writes are tracked from
 * their REQUESTS as they are sent, so a later failed assertion never leaves an untracked document. Every browser
 * context it opens is closed in `finally`, on every return.
 */
export async function runJourney({ browser, fixtures, base, amount = 7, reviewed = REVIEWED_BUILD }) {
  const rows = {};
  const set = (id, ok, seen, status) => { rows[id] = { status: status ?? (ok ? 'PASS' : 'FAIL'), seen }; };
  const productDocs = [];
  const contexts = [];
  const guard = codeGuard(reviewed);
  const ctx = async (viewport = PHONE) => {
    const c = await browser.newContext({ viewport, locale: 'en-US', serviceWorkers: 'block' });
    contexts.push(c);
    await c.route('**/*', guard.handle);
    return c;
  };
  try {
    // The kit's own event: a Champion and ONE verified member of its (private) community, made as fixture preparation.
    const ev = await fixtures.expoEvent('lk', { attendees: 1, target: 1000, seeded: 100 });
    const m = ev.attendees?.[0];
    if (typeof m?.uid !== 'string' || !m.uid) throw new Error('the kit made no verified member for the phone control');
    const a = (await fixtures.memberInTwoCommunities('lka')).member;
    const b = (await fixtures.memberInTwoCommunities('lkb')).member;
    set('fixture-provenance', true, `${ev.setupId}; the phone control is the kit's verified member of this community; visitors A and B are kit accounts outside it`);
    /** Track what a page writes, from the request itself (the path is fixed by the request), before any reply. */
    const track = (page, who, { join = false } = {}) => {
      page.on('request', (req) => {
        let name; let data;
        try { name = /\/(wsf[A-Za-z]+)$/.exec(new URL(req.url()).pathname)?.[1]; data = JSON.parse(req.postData() || '{}')?.data; } catch { return; }
        if (join && name === 'wsfJoinCommunity' && !productDocs.includes(`wsfMemberships/${ev.groupId}_${who.uid}`)) productDocs.push(`wsfMemberships/${ev.groupId}_${who.uid}`);
        if (name === 'wsfContribute' && data?.goalId === ev.goalId && typeof data.attemptId === 'string') fixtures.trackContribution(ev, who, data.attemptId);
      });
    };

    // 1. The kiosk shows its code; the Champion's approval is fixture preparation (the kit's tracked callable). Visitor A
    //    joins through the QR only when the community is link-joinable; the kit's community is private, so the kiosk
    //    shows no join code and qr-join is BLOCKED by name. The QR join never gates the phone control below.
    const kiosk = await (await ctx({ width: 1280, height: 800 })).newPage();
    await kiosk.goto(`${base}/kiosk/${ev.groupId}/${ev.goalId}`);
    guard.check();
    let joinUrl = null;
    try {
      const codeEl = kiosk.getByTestId('kiosk-pair-code');
      await codeEl.waitFor({ timeout: 30_000 });
      const code = (await codeEl.innerText()).replace(/\s+/g, '');
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) set('qr-join', false, 'the kiosk code is not a pairing code');
      else {
        await fixtures.approveStation(ev, code, 1);
        const qr = kiosk.locator('svg[data-testid="kiosk-qr"]');
        await qr.waitFor({ timeout: 40_000 });
        const raw = await qr.getAttribute('data-join-url');
        const u = raw ? new URL(raw) : null;
        joinUrl = u && u.origin === LOVABLE_URL && u.pathname === '/' && /^[A-Za-z0-9_-]{16,128}$/.test(u.searchParams.get('join') ?? '') && u.searchParams.get('goal') === ev.goalId ? u.href : null;
        if (!joinUrl) set('qr-join', false, 'the QR carries no same-host join link for this goal');
      }
    } catch (e) {
      guard.check();
      const noCode = await visible(kiosk.getByText('This goal has no join code to show.'));
      set('qr-join', false, noCode ? QR_KIT_BLOCK : `the kiosk did not reach a QR join link: ${short(e)}`, noCode ? 'BLOCKED' : 'FAIL');
    }
    if (joinUrl) {
      // Visitor A: the real QR link, the product sign-in, the deliberate Join; the phone choice must follow.
      const pageA = await (await ctx()).newPage();
      track(pageA, a, { join: true });
      const logA = callableLog(pageA);
      await pageA.goto(joinUrl);
      guard.check(); // nothing is typed into a page that loaded anything unreviewed
      await signIn(pageA, a);
      const join = pageA.locator('[data-connected-join]').getByRole('button', { name: 'Join', exact: true });
      if ((await uidOf(pageA)) !== a.uid) set('qr-join', false, 'the sign-in did not complete as visitor A');
      else if (!(await visible(join))) set('qr-join', false, 'no Join for a visitor who is not a member');
      else {
        await join.click();
        await pageA.waitForTimeout(5000);
        const joined = logA.last('wsfJoinCommunity');
        const phone = await visible(pageA.getByTestId('join-move-phone'));
        set('qr-join', joined?.result?.groupId === ev.groupId && joined.result.alreadyMember === false && phone,
          `join ${joined?.result?.groupId === ev.groupId ? 'into this community' : 'not into this community'}, alreadyMember=${joined?.result?.alreadyMember}; phone choice ${phone ? 'shown' : 'absent'}`);
      }
    }

    // 2. The phone CONTROL (#589 W4 F1, #365 6052330823): the kit's verified member, signed in through the product UI,
    //    measures the phone rows independently of the QR join.
    const pageM = await (await ctx()).newPage();
    track(pageM, m);
    const logM = callableLog(pageM);
    await pageM.goto(`${base}/`);
    guard.check(); // nothing is typed into a page that loaded anything unreviewed
    await signIn(pageM, m);
    if ((await uidOf(pageM)) !== m.uid) throw new Error('the control member\'s sign-in did not complete');
    await skipTour(pageM);
    await chooseCommunity(pageM);
    const ownBefore = ownCreditOf(logM.last('wsfMyContribution', ev.goalId), ev.goalId);
    await pageM.getByRole('button', { name: 'MOVE — add a contribution' }).first().click();
    await pageM.waitForTimeout(3000);
    await toCountStep(pageM);
    await pageM.locator('input[inputmode=numeric]').first().fill(String(amount));
    await pageM.getByRole('button', { name: 'Review', exact: true }).first().click();
    await pageM.getByTestId('confirm').click();
    const receipt = pageM.locator('section.together-receipt');
    await receipt.waitFor({ timeout: 20_000 });
    await pageM.waitForTimeout(1500);
    const sent = logM.of('wsfContribute');
    const ex = sent.at(-1) ?? null;
    const screen = (await receipt.innerText()).replace(/\s+/g, ' ');
    const r = receiptVerdict(ex, { goalId: ev.goalId, amount, unit: UNIT, screenText: screen });
    const sameAttempt = r.attemptId !== null && (await receipt.getAttribute('data-attempt')) === r.attemptId;
    set('contribution-7', sent.length === 1 && r.attemptId !== null && sameAttempt, `${CONTROL}: ${sent.length} contribution request(s); receipt ${sameAttempt ? 'bound to that request\'s attempt' : 'not bound to that request\'s attempt'}`);
    set('operation-receipt', r.ok && sameAttempt && showsNumber(screen, amount), `${CONTROL}: ${r.seen}`);
    await pageM.getByTestId('together-done').click();
    await pageM.waitForTimeout(1500);
    await skipTour(pageM);

    // Fresh reads for the selected test goal, and the exact Progress row.
    await pageM.reload();
    guard.check();
    await pageM.waitForTimeout(6000);
    await skipTour(pageM);
    const ownAfter = ownCreditOf(logM.last('wsfMyContribution', ev.goalId), ev.goalId);
    const shared = sharedOf(logM.last('wsfGoalPulse', ev.goalId), ev.goalId);
    const before = ownBefore ?? 0; // a fresh account on a goal this run created: provably 0 when not read
    const row = await progressRow(pageM);
    const rowOk = row !== null && row.includes(`${(ownAfter ?? NaN).toLocaleString('en-US')} ${UNIT}`) && showsNumber(row, shared);
    if (ownAfter === null || shared === null) set('own-history-shared', false, `${CONTROL}: own ${ownAfter} shared ${shared}: a selected-goal read is missing`, 'BLOCKED');
    else set('own-history-shared', ownAfter === before + amount && ownAfter === r.ownCredit && shared === r.shared && rowOk,
      `${CONTROL}: own ${before}${ownBefore === null ? ' (fresh, unread)' : ''} -> ${ownAfter} vs receipt ${r.ownCredit}; shared ${shared} vs receipt ${r.shared}; Progress row ${rowOk ? 'exact' : 'missing or different'}`);

    // Reopen MOVE on the same goal: a fresh draft, nothing replayed, no pending attempt, no second request.
    await pageM.locator('[data-tab="home"]').first().click();
    await pageM.getByRole('button', { name: 'MOVE — add a contribution' }).first().click();
    await pageM.waitForTimeout(2000);
    const pending = await pageM.evaluate((k) => localStorage.getItem(k), `wsf.pendingContribution.${ev.goalId}.${m.uid}`);
    const replayed = await visible(pageM.locator('section.together-receipt'));
    set('reopen-static', !replayed && pending === null && logM.sent('wsfContribute') === 1,
      `${CONTROL}: receipt replayed ${replayed}; pending attempt ${pending === null ? 'none' : 'present'}; contribution requests ${logM.sent('wsfContribute')}`);
    await pageM.keyboard.press('Escape');

    // The control -> B (a non-member) in the same browser storage, then the control again in fresh storage.
    await signOut(pageM);
    const logB = callableLog(pageM);
    await pageM.goto(`${base}/`);
    guard.check();
    await signIn(pageM, b);
    await skipTour(pageM);
    const uidB = await uidOf(pageM);
    const pendingJoin = await pageM.evaluate(() => ['wsf.pendingJoinCode', 'wsf.pendingJoinGoal'].filter((k) => sessionStorage.getItem(k) !== null).length);
    const bRow = await progressRow(pageM);
    const bReads = logB.sent('wsfMyContribution', ev.goalId) + logB.sent('wsfGoalPulse', ev.goalId);
    const bClean = uidB === b.uid && pendingJoin === 0 && bRow === null && bReads === 0 && !(await visible(pageM.locator('section.together-receipt')));
    const pageM2 = await (await ctx()).newPage();
    const logM2 = callableLog(pageM2);
    await pageM2.goto(`${base}/`);
    guard.check();
    await signIn(pageM2, m);
    await chooseCommunity(pageM2);
    const back = await uidOf(pageM2);
    const own2 = ownCreditOf(logM2.last('wsfMyContribution', ev.goalId), ev.goalId);
    const row2 = await progressRow(pageM2);
    set('account-isolation', bClean && back === m.uid && own2 === ownAfter && row2 === row,
      `${CONTROL} -> B (non-member) -> ${CONTROL}: B ${uidB === b.uid ? 'signed in' : 'not signed in'}, pending join keys ${pendingJoin}, test-goal reads ${bReads}, Progress row ${bRow === null ? 'absent' : 'present'}; the control back as ${idHash(back) === idHash(m.uid) ? 'the same identity' : 'another identity'}, own ${own2} vs ${ownAfter}, row ${row2 === row ? 'the same' : 'different'}`);
  } catch (e) {
    for (const id of ['fixture-provenance', 'qr-join', 'contribution-7', 'operation-receipt', 'own-history-shared', 'reopen-static', 'account-isolation']) rows[id] ??= { status: 'FAIL', seen: `stopped: ${short(e)}` };
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
  return { rows, productDocs, served: guard.summary() };
}

/** The verdict after cleanup and the scan: PASS only when every row passed and both outcomes are success. */
export function requireVerdict(doc, { cleanup, scan }) {
  const lines = [];
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  for (const r of rows) lines.push(`LOVABLE_ROW ${r.id}=${r.status}`);
  const n = (s) => rows.filter((r) => r.status === s).length;
  lines.push(`LOVABLE_ROWS=${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('BLOCKED')} BLOCKED`);
  lines.push(`LOVABLE_CLEANUP=${cleanup || 'unknown'}`, `LOVABLE_EVIDENCE_SCAN=${scan || 'unknown'}`);
  const ok = allPassed(doc) && cleanup === 'success' && scan === 'success';
  lines.push(`LOVABLE_KIOSK_PROOF=${ok ? 'PASS' : rows.length && n('FAIL') === 0 && n('BLOCKED') > 0 ? 'BLOCKED' : 'FAIL'}`);
  return { ok, lines };
}

// ---- CLI ----------------------------------------------------------------------------------------
/** The real browser: the candidate's pinned Playwright, launched with no cloud or workflow credential in its environment. */
async function launchChromium() {
  const { chromium } = createRequire(path.resolve('apps/westayfit/package.json'))('@playwright/test');
  return chromium.launch({ env: browserEnv(process.env) });
}

/**
 * The CLI. Its exit code IS the gate: the workflow's bind steps stop the mode (before `config` mints anything, and
 * before the job authenticates) only through a non-zero `--bind`, and `--run` must refuse a non-PASS bind before it
 * imports the kit or launches a browser. Exported with injectable edges (#589 W4 F2) so both are tested.
 */
export async function cli(mode, env, { fetchImpl = fetch, reviewed = REVIEWED_BUILD, importKit = () => import('./journeys/fixture-kit.mjs'), launch = launchChromium, say = (l) => console.log(l) } = {}) {
  if (mode === '--require') {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(env.WSF_RESULT_DIR, 'lovable-kiosk', 'results.json'), 'utf8')); } catch { /* no results */ }
    const v = requireVerdict(doc, { cleanup: env.WSF_CLEANUP_OUTCOME, scan: env.WSF_SCAN_OUTCOME });
    v.lines.forEach(say);
    return v.ok ? 0 : 1;
  }
  const b = checkBase(env.WSF_LOVABLE_URL);
  if (!b.ok || env.WSF_PROJECT !== PROJECT_ID) { say(`LOVABLE_BUILD=FAIL (${b.ok ? 'the project is not westayfit-staging' : b.reason})`); return 1; }
  let observed = null;
  let verdict;
  try { observed = await servedManifest(fetchImpl, b.base); verdict = bindBuild(observed, reviewed); } catch (e) { verdict = { status: 'FAIL', reason: `the served build could not be read: ${short(e)}` }; }
  bindLines(observed, verdict).forEach(say);
  if (mode === '--bind') return verdict.status === 'PASS' ? 0 : 1;
  if (mode !== '--run') { say('usage: hosted-lovable-kiosk.mjs --bind | --run | --require'); return 2; }
  const dir = path.join(env.WSF_RESULT_DIR, 'lovable-kiosk');
  fs.mkdirSync(dir, { recursive: true });
  const rows = { 'host-build': { status: verdict.status, seen: verdict.reason } };
  let journey = { rows: {}, productDocs: [] };
  let browser = null;
  let doc = null;
  try {
    if (verdict.status !== 'PASS') return 1;
    const { createFixtureKit } = await importKit();
    let sdk;
    try { const raw = JSON.parse(fs.readFileSync(env.WSF_SDK_CONFIG_FILE, 'utf8')); sdk = raw?.result?.sdkConfig ?? raw?.sdkConfig ?? raw?.result ?? raw; } catch { sdk = null; }
    if (sdk?.projectId !== PROJECT_ID || typeof sdk?.apiKey !== 'string' || !env.WSF_GOOGLE_ACCESS_TOKEN || !env.WSF_CLEANUP_MANIFEST) throw new Error('the staging fixture inputs are missing');
    const runTag = `e5c-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const fixtures = createFixtureKit({ projectId: PROJECT_ID, apiKey: sdk.apiKey, token: env.WSF_GOOGLE_ACCESS_TOKEN, runTag, cleanupManifest: env.WSF_CLEANUP_MANIFEST });
    say(`LOVABLE_RUN_TAG=${runTag}`);
    browser = await launch();
    journey = await runJourney({ browser, fixtures, base: b.base, reviewed });
  } catch (e) {
    rows['fixture-provenance'] ??= { status: 'FAIL', seen: `stopped before the journey: ${short(e)}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (journey.productDocs.length) {
      try {
        if (!env.WSF_CLEANUP_MANIFEST) throw new Error('no cleanup manifest');
        const total = mergeIntoManifest(env.WSF_CLEANUP_MANIFEST, journey.productDocs);
        rows['cleanup-tracking'] = { status: 'PASS', seen: `${journey.productDocs.length} product-written document(s) added; ${total} in the manifest` };
      } catch (e) { rows['cleanup-tracking'] = { status: 'FAIL', seen: `the product-written documents could not be added to the cleanup manifest: ${short(e)}` }; }
    } else if (journey.rows['fixture-provenance']) rows['cleanup-tracking'] = { status: 'PASS', seen: 'nothing product-written to add' };
    doc = runResults(verdict, journey, rows);
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(doc, null, 2)}\n`);
    for (const r of doc.rows) say(`LOVABLE_ROW ${r.id}=${r.status}`);
  }
  return allPassed(doc) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv[2], process.env);
}
