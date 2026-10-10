#!/usr/bin/env node
// WSF-OPERATOR-ACCESS-1: a read-only audit of ONE account's WSF operator access
// in ONE named Firebase project. The owner runs it in their own Cloud Shell.
//
//   node audit-access.mjs westayfit-staging
//   node audit-access.mjs goarrive
//
// THE EMAIL IS TYPED, NEVER CARRIED.
// - It is read from the terminal with echo off. There is no flag, no
//   environment variable and no file for it, and a piped stdin is refused, so
//   nothing on disk or in shell history ever holds it.
// - It is used for exactly one call, the Auth lookup.
// - It is never printed, logged or written. Every line this script writes passes
//   through `redact` as a second guard, and an error is reported by its code
//   only, never by its message.
//
// WHAT IT READS, and nothing else:
// - the Auth user record: emailVerified, disabled, the first 6 characters of the
//   uid, and the provider ids (never the provider entries, whose uid can be the
//   address itself);
// - wsfMemberships where userId == uid: groupId, role and membershipStatus;
// - wsfCommunityGroups/{groupId}: displayName;
// - wsfGoals where communityGroupId == groupId, for an active Champion
//   membership only: id, title and status;
// - the names of the Cloud Functions in us-central1, to say whether the WSF
//   backend is deployed in the project.
//
// IT WRITES NOTHING. No Firestore write, no Auth change, no claim, no grant.
// Every Firestore and Auth call below is a read, and the Cloud Functions call
// is a GET. audit-access.test.mjs proves it against a fake Admin SDK whose write
// methods throw, and checks this file's source for any write call.
//
// The result line is evidence for L0, not a grant: L0 records PROVISIONED or NOT
// PROVISIONED per project from the pasted output.

import { pathToFileURL } from 'node:url';

export const PROJECTS = Object.freeze(['westayfit-staging', 'goarrive']);
export const REGION = 'us-central1';
export const UID_PREFIX_LENGTH = 6;
export const CHAMPION_ROLE = 'foundingChampion';
export const ACTIVE_STATUS = 'active';

const USAGE = [
  'usage: node audit-access.mjs <project>',
  `  <project> is exactly one of: ${PROJECTS.join(', ')}`,
  '  The account email is asked for interactively, with echo off.',
  '  There is no flag, environment variable or file for it.',
].join('\n');

/** An error's code, reduced to a short safe token. Never its message. */
export function errorCode(error) {
  const raw = error && (error.code ?? error.status ?? error.statusCode);
  const code = String(raw ?? 'error').replace(/[^A-Za-z0-9_/-]/g, '').slice(0, 48);
  return code || 'error';
}

/** Remove every case-insensitive occurrence of the typed address from a line. */
export function redact(text, email) {
  const s = String(text);
  if (!email) return s;
  const needle = email.toLowerCase();
  let out = '';
  let i = 0;
  const lower = s.toLowerCase();
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at < 0) return out + s.slice(i);
    out += s.slice(i, at) + '[redacted]';
    i = at + needle.length;
  }
}

/** A stored value, printed exactly when it is a string and as JSON otherwise. */
function exact(v) {
  if (typeof v === 'string' && /^[\x21-\x7e]+$/.test(v)) return v;
  return JSON.stringify(v === undefined ? null : v);
}

/** A display string, quoted so control characters and quotes cannot break a line. */
function quoted(v) {
  return typeof v === 'string' ? JSON.stringify(v) : '(none)';
}

/**
 * The audit itself, over injected readers so it can be proven without a network.
 *
 * deps.auth.getUserByEmail(email): the Admin SDK Auth read.
 * deps.db: the Admin SDK Firestore handle; only collection().where().get() and
 *   doc().get() are used.
 * deps.listFunctionNames(): the short names of the project's Cloud Functions in
 *   REGION, or a throw when they cannot be read.
 * deps.out(line): stdout. deps.err(line): stderr.
 *
 * Returns the result keyword: PROVISIONED, NOT PROVISIONED or UNKNOWN.
 */
export async function runAudit({ project, email, auth, db, listFunctionNames, out, err }) {
  const say = (line) => out(redact(line, email));
  const warn = (line) => err(redact(line, email));

  if (!PROJECTS.includes(project)) throw new Error('unknown project');

  say('WSF operator-access audit (read-only; no write of any kind)');
  say(`project: ${project}`);

  // 1. Is the WSF backend deployed here at all?
  let backend = 'unknown';
  try {
    const names = await listFunctionNames();
    const wsf = names.filter((n) => typeof n === 'string' && n.startsWith('wsf'));
    backend = wsf.length > 0 ? 'present' : 'absent';
    say(
      backend === 'present'
        ? `backend: present (${wsf.length} wsf* Cloud Function(s) in ${REGION}${wsf.includes('wsfHealth') ? ', wsfHealth among them' : ''})`
        : `backend: absent (no wsf* Cloud Function in ${REGION})`
    );
  } catch (e) {
    say(`backend: unknown (the Cloud Functions list could not be read: ${errorCode(e)})`);
  }

  // 2. The Auth account the typed address belongs to.
  let user = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    const code = errorCode(e);
    if (code === 'auth/user-not-found') {
      say('account: not found (no Firebase Auth user in this project has the address typed)');
      say(`result: NOT PROVISIONED in ${project} (no account)`);
      return 'NOT PROVISIONED';
    }
    say(`account: unknown (the Auth lookup failed: ${code})`);
    say(`result: UNKNOWN in ${project} (the account could not be read)`);
    return 'UNKNOWN';
  }
  const uid = typeof user?.uid === 'string' ? user.uid : '';
  const providers = Array.isArray(user?.providerData)
    ? [...new Set(user.providerData.map((p) => p?.providerId).filter((p) => typeof p === 'string'))]
    : [];
  say('account: found');
  say(`  emailVerified: ${user?.emailVerified === true}`);
  say(`  disabled: ${user?.disabled === true}`);
  say(`  uid (first ${UID_PREFIX_LENGTH}): ${uid.slice(0, UID_PREFIX_LENGTH)}`);
  say(`  providers: ${providers.length ? providers.map(exact).join(', ') : '(none)'}`);

  // 3. Every WSF membership of that uid, whatever its state.
  let memberships;
  try {
    const snap = await db.collection('wsfMemberships').where('userId', '==', uid).get();
    memberships = snap.docs.map((d) => d.data() ?? {});
  } catch (e) {
    say(`memberships: unknown (the read failed: ${errorCode(e)})`);
    say(`result: UNKNOWN in ${project} (memberships could not be read)`);
    return 'UNKNOWN';
  }
  memberships.sort((a, b) => String(a.groupId).localeCompare(String(b.groupId)));
  say(`memberships: ${memberships.length}`);

  const operable = [];
  let dormantChampion = 0;
  for (const m of memberships) {
    const groupId = typeof m.groupId === 'string' ? m.groupId : null;
    let name = '(unreadable)';
    if (groupId) {
      try {
        const g = await db.doc(`wsfCommunityGroups/${groupId}`).get();
        name = g.exists ? quoted(g.data()?.displayName) : '(community missing)';
      } catch (e) {
        name = `(unreadable: ${errorCode(e)})`;
      }
    }
    say(`  - group ${exact(groupId)} ${name} role=${exact(m.role)} status=${exact(m.membershipStatus)}`);
    // The server's own test, exactly: requireChampion admits an ACTIVE
    // foundingChampion and nothing else.
    if (m.role === CHAMPION_ROLE && m.membershipStatus === ACTIVE_STATUS && groupId) operable.push({ groupId });
    else if (m.role === CHAMPION_ROLE) dormantChampion += 1;
  }
  if (dormantChampion > 0) {
    say(
      `  note: ${dormantChampion} membership(s) keep role=${CHAMPION_ROLE} while not active. They grant nothing now; ` +
        'a reinstatement or a rejoin through the link would make them active again with the role.'
    );
  }

  // 4. What an active Champion membership lets this account operate.
  say(`champion of: ${operable.length} communit${operable.length === 1 ? 'y' : 'ies'} (active ${CHAMPION_ROLE})`);
  let goalsUnreadable = false;
  for (const { groupId } of operable) {
    try {
      const snap = await db.collection('wsfGoals').where('communityGroupId', '==', groupId).get();
      const goals = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() ?? {}) }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      say(`  - group ${exact(groupId)}: ${goals.length} goal(s)`);
      for (const g of goals) say(`      goal ${exact(g.id)} ${quoted(g.title)} status=${exact(g.status)}`);
    } catch (e) {
      goalsUnreadable = true;
      say(`  - group ${exact(groupId)}: goals unreadable (${errorCode(e)})`);
    }
  }
  if (goalsUnreadable) warn('warning: some goals could not be read; the result below does not depend on them.');

  // 5. The result, stated from server data only.
  if (user?.disabled === true) {
    say(`result: NOT PROVISIONED in ${project} (the account is disabled)`);
    return 'NOT PROVISIONED';
  }
  if (backend === 'absent') {
    say(`result: NOT PROVISIONED in ${project} (the WSF backend is not deployed here, so no WSF right can take effect)`);
    return 'NOT PROVISIONED';
  }
  if (operable.length === 0) {
    say(`result: NOT PROVISIONED in ${project} (no active ${CHAMPION_ROLE} membership)`);
    return 'NOT PROVISIONED';
  }
  if (backend === 'unknown') {
    say(`result: UNKNOWN in ${project} (active ${CHAMPION_ROLE} of ${operable.length}, but the backend could not be confirmed)`);
    return 'UNKNOWN';
  }
  say(`result: PROVISIONED in ${project} (active ${CHAMPION_ROLE} of ${operable.length})`);
  if (user?.emailVerified !== true) {
    say('  note: the address is not verified, so wsfCreateCommunity, wsfCreateGoal and wsfCreateCombinedGoal refuse this account.');
  }
  return 'PROVISIONED';
}

/**
 * Read one line from a TTY with echo off. Backspace edits, Enter ends, Ctrl-C
 * and Ctrl-D cancel. The typed characters are never written anywhere.
 */
export function readHiddenLine(input, output, prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    const done = (fn, arg) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      fn(arg);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return done(resolve, value);
        if (ch === '\u0003' || ch === '\u0004') return done(reject, new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    input.on('data', onData);
  });
}

/** A plausible address: one @, something on each side, no whitespace, not absurdly long. */
export function plausibleEmail(v) {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v);
}

/** The short names of the project's Cloud Functions in REGION, read with a GET. */
export async function listFunctionNamesVia(credential, project, fetchImpl = fetch) {
  const { access_token: token } = await credential.getAccessToken();
  const names = [];
  let pageToken = '';
  do {
    const url =
      `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${REGION}/functions` +
      `?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': project },
    });
    if (!res.ok) throw Object.assign(new Error('list failed'), { code: `http-${res.status}` });
    const body = await res.json();
    for (const f of body.functions ?? []) names.push(String(f.name).split('/').pop());
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return names;
}

export async function main(argv, io = process) {
  const args = argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    io.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (args.length !== 1 || !PROJECTS.includes(args[0])) {
    io.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const project = args[0];
  if (!io.stdin.isTTY || typeof io.stdin.setRawMode !== 'function') {
    io.stderr.write('Refused: run this in an interactive terminal. The email is typed at a prompt, never piped.\n');
    return 2;
  }

  // The SDK first, so a missing install is reported before anything is typed.
  let initializeApp, applicationDefault, getAuth, getFirestore;
  try {
    ({ initializeApp, applicationDefault } = await import('firebase-admin/app'));
    ({ getAuth } = await import('firebase-admin/auth'));
    ({ getFirestore } = await import('firebase-admin/firestore'));
  } catch {
    io.stderr.write('firebase-admin is not installed next to this script. Run: npm install firebase-admin@12.7.0\n');
    return 1;
  }

  let email;
  try {
    email = (await readHiddenLine(io.stdin, io.stderr, 'Email of the account to audit (hidden as you type): ')).trim();
  } catch {
    io.stderr.write('Cancelled. Nothing was read.\n');
    return 130;
  }
  if (!plausibleEmail(email)) {
    io.stderr.write('That does not look like an email address. Nothing was read.\n');
    return 2;
  }

  const credential = applicationDefault();
  const app = initializeApp({ projectId: project, credential }, `wsf-operator-access-${project}`);

  try {
    const result = await runAudit({
      project,
      email,
      auth: getAuth(app),
      db: getFirestore(app),
      listFunctionNames: () => listFunctionNamesVia(credential, project),
      out: (line) => io.stdout.write(`${line}\n`),
      err: (line) => io.stderr.write(`${line}\n`),
    });
    return result === 'UNKNOWN' ? 3 : 0;
  } catch (e) {
    io.stderr.write(`The audit stopped: ${errorCode(e)}. Nothing was written.\n`);
    return 1;
  } finally {
    email = '';
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`The audit stopped: ${errorCode(e)}. Nothing was written.\n`);
      process.exit(1);
    }
  );
}
