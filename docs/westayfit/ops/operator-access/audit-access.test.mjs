// WSF-OPERATOR-ACCESS-1: proof that audit-access.mjs reads only, never shows the
// typed address, prints only a uid prefix, prints roles and statuses exactly,
// and reports a missing account or a missing backend honestly.
//
// A fake Admin SDK, no network, no credential. All data is synthetic and
// labelled: every id and name below is made up for this test.
//
//   node --test docs/westayfit/ops/operator-access/audit-access.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAudit, readHiddenLine, redact, errorCode, plausibleEmail, listFunctionNamesVia, PROJECTS } from './audit-access.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'audit-access.mjs');

// Synthetic fixture values. The address is distinctive so that any leak, of the
// whole address or of its local part, is found by a plain substring search.
const EMAIL = 'Synthetic.Owner+zq7Fixture@example.test';
const LOCAL_PART = 'synthetic.owner+zq7fixture';
const UID = 'SYNTHuid0123456789abcdefXYZ'; // 27 characters, like a real uid
const G1 = 'synthetic-group-champ-01';
const G2 = 'synthetic-group-member-02';
const G3 = 'synthetic-group-removed-03';

const WRITE_METHODS_DB = ['set', 'update', 'delete', 'create', 'add', 'batch', 'runTransaction', 'bulkWriter', 'recursiveDelete'];
const WRITE_METHODS_AUTH = [
  'createUser', 'updateUser', 'deleteUser', 'deleteUsers', 'importUsers', 'setCustomUserClaims',
  'revokeRefreshTokens', 'generatePasswordResetLink', 'generateEmailVerificationLink', 'generateSignInWithEmailLink',
];

/** A fake Admin SDK. Every write method throws and is recorded. Reads are recorded. */
function fakeAdmin({
  user = {
    uid: UID,
    email: EMAIL,
    emailVerified: true,
    disabled: false,
    providerData: [{ providerId: 'password', uid: EMAIL, email: EMAIL }, { providerId: 'google.com', uid: '1098765', email: EMAIL }],
  },
  userError = null,
  memberships = [
    { id: `${G1}_${UID}`, data: { groupId: G1, userId: UID, role: 'foundingChampion', membershipStatus: 'active' } },
    { id: `${G2}_${UID}`, data: { groupId: G2, userId: UID, role: 'member', membershipStatus: 'active' } },
    { id: `${G3}_${UID}`, data: { groupId: G3, userId: UID, role: 'foundingChampion', membershipStatus: 'removed' } },
  ],
  groups = {
    [G1]: { displayName: 'Synthetic Champion Club', createdByUserId: UID },
    [G2]: { displayName: 'Synthetic Member Club', createdByUserId: 'someone-else' },
    [G3]: { displayName: 'Synthetic Removed Club', createdByUserId: UID },
  },
  goals = [
    { id: 'synthetic-goal-b', data: { communityGroupId: G1, title: 'Synthetic squats', status: 'active', ownerUid: UID } },
    { id: 'synthetic-goal-a', data: { communityGroupId: G1, title: 'Synthetic lunges', status: 'closed', ownerUid: UID } },
    { id: 'synthetic-goal-c', data: { communityGroupId: G2, title: 'Not operable', status: 'active', ownerUid: 'x' } },
  ],
  functionNames = ['wsfHealth', 'wsfCreateGoal', 'otherThing'],
  functionsError = null,
  failCollection = null,
} = {}) {
  const writes = [];
  const reads = [];
  const forbid = (name) => () => {
    writes.push(name);
    throw new Error(`write method ${name} called`);
  };
  const withForbidden = (obj, names) => {
    for (const n of names) obj[n] = forbid(n);
    return obj;
  };
  const snap = (rows) => ({
    docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
    empty: rows.length === 0,
    size: rows.length,
  });
  const tables = { wsfMemberships: memberships, wsfGoals: goals };
  const db = withForbidden(
    {
      collection(name) {
        return withForbidden(
          {
            where(field, op, value) {
              assert.equal(op, '==', 'only equality queries are expected');
              return withForbidden(
                {
                  async get() {
                    reads.push({ collection: name, field, value });
                    if (failCollection === name) throw Object.assign(new Error(`denied for ${EMAIL}`), { code: 7 });
                    return snap((tables[name] ?? []).filter((r) => r.data[field] === value));
                  },
                },
                WRITE_METHODS_DB
              );
            },
          },
          WRITE_METHODS_DB
        );
      },
      doc(p) {
        return withForbidden(
          {
            async get() {
              reads.push({ doc: p });
              const [col, id] = p.split('/');
              const data = col === 'wsfCommunityGroups' ? groups[id] : undefined;
              return { exists: data !== undefined, data: () => data };
            },
          },
          WRITE_METHODS_DB
        );
      },
    },
    WRITE_METHODS_DB
  );
  const lookups = [];
  const auth = withForbidden(
    {
      async getUserByEmail(e) {
        lookups.push(e);
        if (userError) throw userError;
        return user;
      },
    },
    WRITE_METHODS_AUTH
  );
  const listFunctionNames = async () => {
    if (functionsError) throw functionsError;
    return functionNames;
  };
  return { db, auth, listFunctionNames, writes, reads, lookups };
}

async function run(opts = {}, project = 'westayfit-staging') {
  const fake = fakeAdmin(opts);
  const stdout = [];
  const stderr = [];
  const result = await runAudit({
    project,
    email: EMAIL,
    auth: fake.auth,
    db: fake.db,
    listFunctionNames: fake.listFunctionNames,
    out: (l) => stdout.push(l),
    err: (l) => stderr.push(l),
  });
  return { ...fake, result, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function assertNoAddress(text) {
  const lower = text.toLowerCase();
  assert.ok(!lower.includes(EMAIL.toLowerCase()), 'the address must never appear');
  assert.ok(!lower.includes(LOCAL_PART), 'the local part must never appear');
  assert.ok(!lower.includes('example.test'), 'the domain must never appear');
}

function assertOnlyUidPrefix(text) {
  assert.ok(!text.includes(UID), 'the full uid must never appear');
  assert.ok(!text.includes(UID.slice(0, 7)), 'no more than 6 characters of the uid may appear');
  const shown = text.split('\n').filter((l) => l.includes(UID.slice(0, 6)));
  assert.deepEqual(shown, ['  uid (first 6): SYNTHu']);
}

test('a Champion with the backend present: PROVISIONED, read-only, no address, uid prefix only', async () => {
  const r = await run();
  assert.equal(r.result, 'PROVISIONED');
  assert.deepEqual(r.writes, [], 'no write method may be called');
  assert.deepEqual(r.lookups, [EMAIL], 'the typed address is used for exactly one Auth read');
  assertNoAddress(r.stdout);
  assertNoAddress(r.stderr);
  assertOnlyUidPrefix(`${r.stdout}\n${r.stderr}`);
  assert.equal(
    r.stdout,
    [
      'WSF operator-access audit (read-only; no write of any kind)',
      'project: westayfit-staging',
      'backend: present (2 wsf* Cloud Function(s) in us-central1, wsfHealth among them)',
      'account: found',
      '  emailVerified: true',
      '  disabled: false',
      '  uid (first 6): SYNTHu',
      '  providers: password, google.com',
      'memberships: 3',
      `  - group ${G1} "Synthetic Champion Club" role=foundingChampion status=active`,
      `  - group ${G2} "Synthetic Member Club" role=member status=active`,
      `  - group ${G3} "Synthetic Removed Club" role=foundingChampion status=removed`,
      '  note: 1 membership(s) keep role=foundingChampion while not active. They grant nothing now; a reinstatement or a rejoin through the link would make them active again with the role.',
      'champion of: 1 community (active foundingChampion)',
      `  - group ${G1}: 2 goal(s)`,
      '      goal synthetic-goal-a "Synthetic lunges" status=closed',
      '      goal synthetic-goal-b "Synthetic squats" status=active',
      'result: PROVISIONED in westayfit-staging (active foundingChampion of 1)',
    ].join('\n')
  );
  assert.equal(r.stderr, '');
});

test('the reads are exactly the ones the doc names', async () => {
  const r = await run();
  assert.deepEqual(r.reads, [
    { collection: 'wsfMemberships', field: 'userId', value: UID },
    { doc: `wsfCommunityGroups/${G1}` },
    { doc: `wsfCommunityGroups/${G2}` },
    { doc: `wsfCommunityGroups/${G3}` },
    { collection: 'wsfGoals', field: 'communityGroupId', value: G1 },
  ]);
});

test('roles and statuses print exactly as stored, and only an ACTIVE foundingChampion is operable', async () => {
  const memberships = [
    { id: 'm1', data: { groupId: 'synthetic-g-1', role: 'foundingChampion', membershipStatus: 'departed' } },
    { id: 'm2', data: { groupId: 'synthetic-g-2', role: 'FoundingChampion', membershipStatus: 'active' } },
    { id: 'm3', data: { groupId: 'synthetic-g-3', role: 'foundingChampion', membershipStatus: 'Active' } },
    { id: 'm4', data: { groupId: 'synthetic-g-4', role: 'member', membershipStatus: 'removed' } },
    { id: 'm5', data: { groupId: 'synthetic-g-5', role: null, membershipStatus: true } },
    { id: 'm6', data: { groupId: 'synthetic-g-6' } },
    { id: 'm7', data: { groupId: 'synthetic-g-7', role: 'foundingChampion ', membershipStatus: 'active' } },
  ].map((m) => ({ ...m, data: { userId: UID, ...m.data } }));
  const r = await run({ memberships, groups: {} });
  assert.equal(r.result, 'NOT PROVISIONED');
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('  - group synthetic-g-'));
  assert.deepEqual(rows, [
    '  - group synthetic-g-1 (community missing) role=foundingChampion status=departed',
    '  - group synthetic-g-2 (community missing) role=FoundingChampion status=active',
    '  - group synthetic-g-3 (community missing) role=foundingChampion status=Active',
    '  - group synthetic-g-4 (community missing) role=member status=removed',
    '  - group synthetic-g-5 (community missing) role=null status=true',
    '  - group synthetic-g-6 (community missing) role=null status=null',
    '  - group synthetic-g-7 (community missing) role="foundingChampion " status=active',
  ]);
  assert.match(r.stdout, /^champion of: 0 communities \(active foundingChampion\)$/m);
  assert.match(r.stdout, /^  note: 2 membership\(s\) keep role=foundingChampion while not active\./m);
  assert.match(r.stdout, /^result: NOT PROVISIONED in westayfit-staging \(no active foundingChampion membership\)$/m);
  assert.ok(!r.reads.some((x) => x.collection === 'wsfGoals'), 'no goal is read for a non-operable membership');
  assert.deepEqual(r.writes, []);
});

test('a missing account is reported honestly, and an error message carrying the address is never shown', async () => {
  const userError = Object.assign(new Error(`There is no user record for ${EMAIL}`), { code: 'auth/user-not-found' });
  const r = await run({ userError });
  assert.equal(r.result, 'NOT PROVISIONED');
  assert.match(r.stdout, /^account: not found \(no Firebase Auth user in this project has the address typed\)$/m);
  assert.match(r.stdout, /^result: NOT PROVISIONED in westayfit-staging \(no account\)$/m);
  assert.ok(!r.stdout.includes('memberships:'), 'nothing is read for a missing account');
  assert.deepEqual(r.reads, []);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
  assert.deepEqual(r.writes, []);
});

test('any other Auth failure is UNKNOWN, by code only', async () => {
  const userError = Object.assign(new Error(`lookup of ${EMAIL} was refused`), { code: 'auth/insufficient-permission' });
  const r = await run({ userError });
  assert.equal(r.result, 'UNKNOWN');
  assert.match(r.stdout, /^account: unknown \(the Auth lookup failed: auth\/insufficient-permission\)$/m);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('a project with no WSF backend is NOT PROVISIONED, even with a Champion row', async () => {
  const r = await run({ functionNames: ['someGoArriveFunction', 'anotherOne'] }, 'goarrive');
  assert.equal(r.result, 'NOT PROVISIONED');
  assert.match(r.stdout, /^project: goarrive$/m);
  assert.match(r.stdout, /^backend: absent \(no wsf\* Cloud Function in us-central1\)$/m);
  assert.match(
    r.stdout,
    /^result: NOT PROVISIONED in goarrive \(the WSF backend is not deployed here, so no WSF right can take effect\)$/m
  );
  assert.deepEqual(r.writes, []);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('an empty project (no backend, no account) says both plainly', async () => {
  const r = await run(
    { functionNames: [], userError: Object.assign(new Error('x'), { code: 'auth/user-not-found' }) },
    'goarrive'
  );
  assert.equal(r.result, 'NOT PROVISIONED');
  assert.match(r.stdout, /^backend: absent/m);
  assert.match(r.stdout, /^account: not found/m);
});

test('a backend that cannot be listed is UNKNOWN, never PROVISIONED', async () => {
  const functionsError = Object.assign(new Error(`403 for ${EMAIL}`), { code: 'http-403' });
  const r = await run({ functionsError });
  assert.equal(r.result, 'UNKNOWN');
  assert.match(r.stdout, /^backend: unknown \(the Cloud Functions list could not be read: http-403\)$/m);
  assert.match(r.stdout, /^result: UNKNOWN in westayfit-staging \(active foundingChampion of 1, but the backend could not be confirmed\)$/m);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('memberships that cannot be read are UNKNOWN, by code only', async () => {
  const r = await run({ failCollection: 'wsfMemberships' });
  assert.equal(r.result, 'UNKNOWN');
  assert.match(r.stdout, /^memberships: unknown \(the read failed: 7\)$/m);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('goals that cannot be read are flagged and do not change the result', async () => {
  const r = await run({ failCollection: 'wsfGoals' });
  assert.equal(r.result, 'PROVISIONED');
  assert.match(r.stdout, new RegExp(`^  - group ${G1}: goals unreadable \\(7\\)$`, 'm'));
  assert.match(r.stderr, /^warning: some goals could not be read/m);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('a disabled account is NOT PROVISIONED', async () => {
  const r = await run({ user: { uid: UID, emailVerified: true, disabled: true, providerData: [] } });
  assert.equal(r.result, 'NOT PROVISIONED');
  assert.match(r.stdout, /^  disabled: true$/m);
  assert.match(r.stdout, /^result: NOT PROVISIONED in westayfit-staging \(the account is disabled\)$/m);
});

test('an unverified Champion is PROVISIONED, with the create refusals named', async () => {
  const r = await run({ user: { uid: UID, emailVerified: false, disabled: false, providerData: [{ providerId: 'password' }] } });
  assert.equal(r.result, 'PROVISIONED');
  assert.match(r.stdout, /^  emailVerified: false$/m);
  assert.match(r.stdout, /^  note: the address is not verified, so wsfCreateCommunity, wsfCreateGoal and wsfCreateCombinedGoal refuse this account\.$/m);
});

test('names with quotes or control characters cannot forge a line', async () => {
  const groups = { [G1]: { displayName: 'Evil"\nresult: PROVISIONED' }, [G2]: { displayName: 'ok' }, [G3]: {} };
  const r = await run({ groups });
  const lines = r.stdout.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('result:')).length, 1, 'exactly one result line');
  assert.ok(lines.includes(`  - group ${G1} "Evil\\"\\nresult: PROVISIONED" role=foundingChampion status=active`));
  assert.ok(lines.includes(`  - group ${G3} (none) role=foundingChampion status=removed`));
});

test('an unknown project is refused before any read', async () => {
  const fake = fakeAdmin();
  await assert.rejects(
    runAudit({ project: 'production', email: EMAIL, ...fake, out: () => {}, err: () => {} }),
    /unknown project/
  );
  assert.deepEqual(fake.reads, []);
  assert.deepEqual(fake.lookups, []);
  assert.deepEqual(PROJECTS, ['westayfit-staging', 'goarrive']);
});

test('redact removes the address in any case; errorCode never returns a message', () => {
  assert.equal(redact(`a ${EMAIL.toUpperCase()} b ${EMAIL}`, EMAIL), 'a [redacted] b [redacted]');
  assert.equal(errorCode(Object.assign(new Error(EMAIL), { code: 'auth/user-not-found' })), 'auth/user-not-found');
  assert.equal(errorCode(new Error(EMAIL)), 'error');
  assert.equal(errorCode({ status: 403 }), '403');
  assert.equal(errorCode({ code: 'a b.c@d' }), 'abcd');
  assert.equal(errorCode({ code: 'x'.repeat(200) }).length, 48);
});

test('plausibleEmail accepts one @ and refuses the rest', () => {
  assert.ok(plausibleEmail(EMAIL));
  for (const bad of ['', 'no-at-sign', 'a@b@c', 'has space@x.test', '@x.test', 'x@', `${'a'.repeat(250)}@x.test`, null]) {
    assert.ok(!plausibleEmail(bad), String(bad));
  }
});

/** A fake TTY: raw mode on and off is recorded; data is pushed by the test. */
function fakeTty() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.raw = [];
  input.setRawMode = (on) => input.raw.push(on);
  input.resume = () => {};
  input.pause = () => {};
  const written = [];
  const output = { write: (s) => written.push(String(s)) };
  return { input, output, written };
}

test('the prompt reads with echo off: nothing typed is written, backspace edits, raw mode is restored', async () => {
  const { input, output, written } = fakeTty();
  const p = readHiddenLine(input, output, 'Email: ');
  input.emit('data', Buffer.from('Synthetic.Ownerx'));
  input.emit('data', Buffer.from('\u007f+zq7Fixture@example.test\r'));
  assert.equal(await p, EMAIL);
  assert.deepEqual(written, ['Email: ', '\n']);
  assert.deepEqual(input.raw, [true, false]);
  assert.equal(input.listenerCount('data'), 0);
});

test('Ctrl-C at the prompt cancels without returning anything', async () => {
  const { input, output, written } = fakeTty();
  const p = readHiddenLine(input, output, 'Email: ');
  input.emit('data', Buffer.from('partial\u0003'));
  await assert.rejects(p, /cancelled/);
  assert.deepEqual(written, ['Email: ', '\n']);
  assert.deepEqual(input.raw, [true, false]);
});

function cli(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: `${EMAIL}\n`,
    env: { PATH: process.env.PATH, WSF_AUDIT_EMAIL: EMAIL, EMAIL, ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
}

test('the CLI refuses a piped address, even with the address in the environment', () => {
  const r = cli(['westayfit-staging']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^Refused: run this in an interactive terminal\./m);
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('the CLI has no email flag, and takes exactly one allowed project', () => {
  for (const args of [
    ['--email', EMAIL, 'westayfit-staging'],
    [`--email=${EMAIL}`],
    ['westayfit-staging', 'goarrive'],
    ['production'],
    ['westayfit-prod'],
    [],
  ]) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /^usage: node audit-access\.mjs <project>$/m);
    assertNoAddress(`${r.stdout}\n${r.stderr}`);
  }
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /There is no flag, environment variable or file for it\./);
});

test('the source has no write call, no file write, no environment read and no non-GET request', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  // Code only: block comments and line comments (a // after start or space) are removed.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const forbidden = [
    /\.(set|update|delete|create|add|batch|runTransaction|bulkWriter|recursiveDelete)\s*\(/,
    /\b(createUser|updateUser|deleteUser|deleteUsers|importUsers|setCustomUserClaims|revokeRefreshTokens|generate\w*Link)\b/,
    /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rmSync|unlink)\b/,
    /process\.env/,
    /console\./,
    /method:\s*'(POST|PUT|PATCH|DELETE)'/i,
  ];
  for (const re of forbidden) assert.ok(!re.test(code), `forbidden pattern in source: ${re}`);
  // The address variable reaches an output call only through redact. Single-
  // quoted literals are dropped first, so prose such as 'an email address' in a
  // message is not mistaken for the variable; template literals are kept, so
  // `${email}` is seen.
  for (const line of code.split('\n')) {
    const bare = line.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
    if (/\b(write|out|err|say|warn)\s*\(/.test(bare) && /\bemail\b/.test(bare)) {
      assert.match(bare, /=> (out|err)\(redact\(line, email\)\);$/, `the address reaches an output call: ${line.trim()}`);
    }
  }
  const fetches = code.match(/fetch(Impl)?\(/g) ?? [];
  assert.equal(fetches.length, 1, 'exactly one network call site');
  assert.match(code, /method:\s*'GET'/);
  const lookups = code.match(/getUserByEmail\(/g) ?? [];
  assert.equal(lookups.length, 1, 'the address is used at exactly one call site');
});

test('the backend list is GET-only, carries the quota project, follows pages, and fails by status', async () => {
  const calls = [];
  const credential = { getAccessToken: async () => ({ access_token: 'synthetic-token' }) };
  const pages = [
    { functions: [{ name: 'projects/p/locations/us-central1/functions/wsfHealth' }, { name: 'projects/p/locations/us-central1/functions/other' }], nextPageToken: 'synthetic page/2' },
    { functions: [{ name: 'projects/p/locations/us-central1/functions/wsfCreateGoal' }] },
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => pages[calls.length - 1] };
  };
  const names = await listFunctionNamesVia(credential, 'westayfit-staging', fetchImpl);
  assert.deepEqual(names, ['wsfHealth', 'other', 'wsfCreateGoal']);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.init.method, 'GET');
    assert.deepEqual(Object.keys(c.init).sort(), ['headers', 'method']);
    assert.equal(c.init.headers.authorization, 'Bearer synthetic-token');
    assert.equal(c.init.headers['x-goog-user-project'], 'westayfit-staging');
  }
  assert.equal(calls[0].url, 'https://cloudfunctions.googleapis.com/v2/projects/westayfit-staging/locations/us-central1/functions?pageSize=1000');
  assert.equal(calls[1].url, `${calls[0].url}&pageToken=synthetic%20page%2F2`);

  const denied = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(listFunctionNamesVia(credential, 'goarrive', denied), (e) => errorCode(e) === 'http-403');
});

test('a community or goal named with the address itself is printed redacted', async () => {
  const groups = { [G1]: { displayName: `Club of ${EMAIL.toLowerCase()}` }, [G2]: { displayName: 'ok' }, [G3]: {} };
  const goals = [{ id: 'synthetic-goal-x', data: { communityGroupId: G1, title: `${EMAIL} squats`, status: 'active' } }];
  const r = await run({ groups, goals });
  assert.ok(r.stdout.split('\n').includes(`  - group ${G1} "Club of [redacted]" role=foundingChampion status=active`));
  assert.ok(r.stdout.split('\n').includes('      goal synthetic-goal-x "[redacted] squats" status=active'));
  assertNoAddress(`${r.stdout}\n${r.stderr}`);
});

test('redact keeps its place when lower-casing changes the text length', () => {
  const dotted = 'İ'.repeat(30);
  assert.equal(redact(`goal "${dotted} ${EMAIL}"`, EMAIL), `goal "${dotted} [redacted]"`);
  assert.equal(redact(`goal "İ ${EMAIL.toUpperCase()}" x`, EMAIL), 'goal "İ [redacted]" x');
  assert.equal(redact('a+b@x.test ab@x.test', 'a+b@x.test'), '[redacted] ab@x.test');
});
