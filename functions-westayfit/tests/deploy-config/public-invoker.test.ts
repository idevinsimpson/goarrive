/**
 * WHICH CALLABLES A SIGNED-OUT STRANGER CAN REACH — PINNED, BECAUSE NOTHING
 * ELSE CAN CATCH IT.
 *
 * `invoker: 'public'` is enforced by Cloud Run IAM at deploy time. The
 * Functions emulator ignores it completely: every callable is reachable
 * locally whatever the marker says. So a `public` added to the wrong callable
 * passes the entire local suite, passes the gate, passes review if nobody
 * happens to read that one line — and first takes effect in front of real
 * people.
 *
 * THIS MATTERS MORE NOW THAN IT DID LAST WEEK. Until `wsfCommunityMembers`
 * there was no callable in this file that returned one member's name to
 * another, so a stray `public` leaked aggregates at worst. It now sits a few
 * lines from a surface that returns people's names, and the two nearest
 * callables in the file — `wsfPreviewCommunity` and `wsfChallengePulse` — are
 * both public. A copied options object is the single likeliest way this
 * feature ever becomes reachable signed out.
 *
 * The list below is therefore an ALLOWLIST, not a snapshot. Adding a name to
 * it is a deliberate decision that an unauthenticated stranger may call that
 * function, and it belongs in a review of its own.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not fastidiousness: the
 * first version of this check read the raw source and reported
 * `wsfCommunityMembers` as public, on the strength of the comment above it
 * saying it must never be public. A guard that reads prose cannot tell a
 * promise from a breach of it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every callable a signed-out client is ALLOWED to reach, with the reason.
 * Kiosks, displays and station hardware sign in as nobody by design; the
 * password-reset sender is reachable by someone who cannot sign in, which is
 * the entire point of it.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  wsfPreviewCommunity: 'a stranger opening an invitation link has no account yet',
  wsfChallengePulse: 'the kiosk display is unauthenticated; aggregates only',
  wsfGoalPulse: 'same, for a goal',
  wsfCombinedGoalPulse: 'same, for a combined goal',
  wsfGoalRecentAdditions: 'the display strip; server-shaped, no identity',
  wsfSendPasswordResetEmail: 'reachable by someone who cannot sign in',
  wsfStationRequestPairing: 'station hardware pairs before it has any identity',
  wsfStationPairingStatus: 'the pairing poll, same phase',
  wsfStationClaimPairing: 'the claim, same phase',
  wsfStationState: 'the station render loop',
  wsfTurnState: 'the station render loop',
  wsfCallNext: 'a station control; the station is not a person',
  wsfStartTurn: 'a station control',
  wsfCompleteTurn: 'a station control',
  wsfCancelTurn: 'a station control',
};

/**
 * Remove comments without removing anything inside a string or template
 * literal, so a `//` in a URL or a `/*` in a regex cannot truncate the file.
 */
function stripComments(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '/' && s[i + 1] === '*') {
      const j = s.indexOf('*/', i + 2);
      i = j < 0 ? s.length : j + 2;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      const j = s.indexOf('\n', i);
      i = j < 0 ? s.length : j;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out.push(c);
      i += 1;
      while (i < s.length) {
        if (s[i] === '\\') {
          out.push(s.slice(i, i + 2));
          i += 2;
          continue;
        }
        out.push(s[i]!);
        if (s[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out.push(c);
    i += 1;
  }
  return out.join('');
}

/** The names of every `onCall` export carrying `invoker: 'public'`. */
function publicCallables(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  const re = /export const (wsf\w+) = onCall/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // The options object is everything between the export and the handler.
    const rest = code.slice(m.index + m[0].length);
    const handlerAt = rest.indexOf('async (');
    const options = rest.slice(0, handlerAt < 0 ? 300 : handlerAt);
    if (options.includes("invoker: 'public'")) found.push(m[1]!);
  }
  return found;
}

const SOURCE = readFileSync(path.join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');

describe('public invoker allowlist', () => {
  test('exactly the callables on the allowlist are public', () => {
    expect(publicCallables(SOURCE).sort()).toEqual(Object.keys(PUBLIC_BY_DESIGN).sort());
  });

  test('the member directory and the visibility setter are NEVER public', () => {
    /*
      Named separately from the set comparison above so the failure says what
      went wrong rather than printing a diff of sixteen names. These two are
      the only callables in the file that touch the choice to be named.
    */
    const pub = publicCallables(SOURCE);
    expect(pub).not.toContain('wsfCommunityMembers');
    expect(pub).not.toContain('wsfSetCommunityVisibility');
  });

  test('the checker is not fooled by a comment that mentions the marker', () => {
    /*
      THE BUG THIS TEST EXISTS FOR. `wsfCommunityMembers` carries a comment
      reading "NO `invoker: 'public'`" — and the first version of this check
      read it as a public marker, reporting a correctly private callable as
      exposed. Had it been written the other way round, a real `public` inside
      a commented-out options object would have gone unseen.
    */
    const fixture = [
      "// invoker: 'public' — this is prose, not configuration",
      "export const wsfQuietOne = onCall(",
      "  /* invoker: 'public' would be wrong here */",
      "  { region: 'us-central1' },",
      "  async (request) => ({}));",
      "export const wsfLoudOne = onCall(",
      "  { region: 'us-central1', invoker: 'public' },",
      "  async (request) => ({}));",
    ].join('\n');
    expect(publicCallables(fixture)).toEqual(['wsfLoudOne']);
  });

  test('stripping never truncates the file on a slash inside a string', () => {
    const fixture = [
      "const url = 'https://example.test/a//b';",
      "export const wsfAfterTheUrl = onCall(",
      "  { region: 'us-central1', invoker: 'public' },",
      "  async (request) => ({}));",
    ].join('\n');
    expect(publicCallables(fixture)).toEqual(['wsfAfterTheUrl']);
  });

  test('every allowlisted callable still exists', () => {
    // An allowlist that outlives the thing it allows is a stale exemption
    // waiting to re-apply to a future callable with the same name.
    for (const name of Object.keys(PUBLIC_BY_DESIGN)) {
      expect(SOURCE).toContain(`export const ${name} = onCall`);
    }
  });
});
