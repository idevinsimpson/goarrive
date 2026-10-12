/**
 * KIOSK-LIVE-POSE-2 — the configuration around the Realtime Database rules,
 * read from the files themselves. No emulator: like the rest of this folder it
 * only reads configuration.
 *
 *   - GoArrive's firebase.json declares no `database`, so no GoArrive deploy
 *     can carry WSF's Realtime Database rules, or any.
 *   - The emulator harness serves database.westayfit.rules.json on loopback.
 *   - The rules grant exactly two things, both under /wsfLivePose/$key/frame:
 *     a read, and the writer's write. Nothing else in the tree is granted,
 *     and the readable node holds only { seq, t, p, rep }.
 */
import { readFileSync } from 'fs';
import * as path from 'path';

const repo = (f: string) => path.resolve(__dirname, '../../..', f);
const json = (f: string) => JSON.parse(readFileSync(repo(f), 'utf8'));

type Node = { [k: string]: Node | string | boolean };

/** Every [path, rule kind] the rules grant, anywhere in the tree. */
function grants(node: Node, at: string[] = []): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === '.read' || k === '.write') {
      if (v !== false) out.push(`${[...at].join('/')} ${k}`);
    } else if (typeof v === 'object' && v !== null) {
      out.push(...grants(v as Node, [...at, k]));
    }
  }
  return out;
}

describe('KIOSK-LIVE-POSE-2 configuration', () => {
  test('firebase.json (GoArrive) declares no database', () => {
    expect(json('firebase.json')).not.toHaveProperty('database');
  });

  test('the WSF hosting deploy config declares no database either', () => {
    expect(json('firebase.westayfit.json')).not.toHaveProperty('database');
  });

  test('the emulator harness loads the reviewed rules and runs the database on loopback', () => {
    const c = json('firebase.westayfit.emulators.json');
    expect(c.database).toEqual({ rules: 'database.westayfit.rules.json' });
    expect(c.emulators.database).toEqual({ host: '127.0.0.1', port: 9000 });
  });

  test('the rules deny at the root and grant only the frame read and the frame write', () => {
    const rules = json('database.westayfit.rules.json').rules as Node;
    expect(rules['.read']).toBe(false);
    expect(rules['.write']).toBe(false);
    expect(Object.keys(rules).sort()).toEqual(['.read', '.write', 'wsfLivePose']);
    expect(grants(rules).sort()).toEqual(
      ['wsfLivePose/$key/frame .read', 'wsfLivePose/$key/frame .write'].sort()
    );
    const key = (rules.wsfLivePose as Node).$key as Node;
    expect(Object.keys(key)).toEqual(['frame']);
    expect(Object.keys(rules.wsfLivePose as Node)).toEqual(['$key']);
  });

  test('the readable node holds exactly seq, t, p and rep', () => {
    const frame = ((json('database.westayfit.rules.json').rules.wsfLivePose as Node).$key as Node)
      .frame as Node;
    expect(Object.keys(frame).filter((k) => !k.startsWith('.')).sort()).toEqual(
      ['$other', 'p', 'rep', 'seq', 't'].sort()
    );
    expect((frame.$other as Node)['.validate']).toBe(false);
    expect(frame['.validate']).toContain("newData.hasChildren(['seq', 't', 'p', 'rep'])");
  });

  test('the frame write names the writer in meta, refuses anonymous tokens and stops at expiry', () => {
    const frame = ((json('database.westayfit.rules.json').rules.wsfLivePose as Node).$key as Node)
      .frame as Node;
    const write = frame['.write'] as string;
    expect(write).toContain("auth.uid === root.child('wsfLivePose').child($key).child('meta').child('writerUid').val()");
    expect(write).toContain("auth.token.firebase.sign_in_provider !== 'anonymous'");
    expect(write).toContain("root.child('wsfLivePose').child($key).child('meta').child('expiresAt').val() > now");
    expect(frame['.read']).toBe("root.child('wsfLivePose').child($key).child('meta').child('expiresAt').val() > now");
  });
});
