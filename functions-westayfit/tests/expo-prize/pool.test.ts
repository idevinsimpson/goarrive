/**
 * EXP2B — the pool builder. PURE CORE ONLY: no Firestore. Proves the
 * deterministic aggregation, ranges, digests, refusals and privacy shape of
 * the pool record — never atomicity, which freeze.test.ts proves on the
 * emulator.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import {
  POOL_MAX_SERIALIZED_BYTES,
  POOL_VERSION,
  buildPool,
  canonicalPoolJson,
  poolDigest,
  poolSerializedBytes,
  storedPoolIntact,
  type PoolEntryInput,
} from '../../src/expo-prize';
import { deepStrings, shuffle } from './fixtures';

const meta = { ruleVersion: 3, enabledConfigDigest: 'a'.repeat(64) };
const e = (entrantId: string, tickets = 1, status: PoolEntryInput['status'] = 'confirmed'): PoolEntryInput => ({
  entrantId,
  tickets,
  status,
});

describe('pool builder (pure)', () => {
  test('aggregates tickets by entrant, sorts canonically, lays out contiguous 1-based ranges', () => {
    const built = buildPool([e('m', 1), e('a', 2), e('m', 3), e('Z', 1)], meta);
    if (!built.ok) throw new Error(built.problem.reason);
    // Code-unit order: 'Z' < 'a' < 'm'.
    expect(built.pool.ranges).toEqual([
      { entrantId: 'Z', ticketStart: 1, ticketEnd: 1 },
      { entrantId: 'a', ticketStart: 2, ticketEnd: 3 },
      { entrantId: 'm', ticketStart: 4, ticketEnd: 7 },
    ]);
    expect(built.pool.totalTickets).toBe(7);
    expect(built.pool.entrantCount).toBe(3);
    expect(built.pool.ruleVersion).toBe(3);
    expect(built.pool.enabledConfigDigest).toBe(meta.enabledConfigDigest);
    expect(built.pool.poolVersion).toBe(POOL_VERSION);
    expect(built.excluded).toEqual({ pending: 0, revoked: 0, other: 0 });
  });

  test('the same entries in any order give a byte-identical pool and digest', () => {
    const entries = Array.from({ length: 40 }, (_, i) => e(`ent_${(i * 7919) % 23}`, 1 + (i % 3)));
    const ref = buildPool(entries, meta);
    if (!ref.ok) throw new Error(ref.problem.reason);
    for (let k = 0; k < 10; k++) {
      const again = buildPool(shuffle(entries), meta);
      if (!again.ok) throw new Error(again.problem.reason);
      expect(JSON.stringify(again.pool)).toBe(JSON.stringify(ref.pool));
      expect(again.pool.poolDigest).toBe(ref.pool.poolDigest);
    }
    // The stored digest is the digest of the stored content.
    const { poolDigest: stored, ...body } = ref.pool;
    expect(poolDigest(body)).toBe(stored);
    expect(storedPoolIntact(ref.pool)).toBe(true);
  });

  test('the digest covers rule version, enablement digest and every range', () => {
    const base = buildPool([e('a', 1), e('b', 2)], meta);
    if (!base.ok) throw new Error(base.problem.reason);
    const ruleChanged = buildPool([e('a', 1), e('b', 2)], { ...meta, ruleVersion: 4 });
    const configChanged = buildPool([e('a', 1), e('b', 2)], { ...meta, enabledConfigDigest: 'b'.repeat(64) });
    const ticketsChanged = buildPool([e('a', 1), e('b', 3)], meta);
    const entrantChanged = buildPool([e('a', 1), e('c', 2)], meta);
    for (const other of [ruleChanged, configChanged, ticketsChanged, entrantChanged]) {
      if (!other.ok) throw new Error(other.problem.reason);
      expect(other.pool.poolDigest).not.toBe(base.pool.poolDigest);
    }
    // An edited stored pool no longer matches its own digest.
    const edited = { ...base.pool, ranges: [{ ...base.pool.ranges[0] }, { ...base.pool.ranges[1], ticketEnd: 99 }] };
    expect(storedPoolIntact(edited)).toBe(false);
    expect(storedPoolIntact({ ...base.pool, totalTickets: 4 })).toBe(false);
    expect(storedPoolIntact(null)).toBe(false);
    expect(storedPoolIntact({})).toBe(false);
  });

  test('form bonus tickets count as tickets; pending and revoked entries carry none', () => {
    const built = buildPool([e('a', 1), e('a', 5), e('b', 1, 'revoked'), e('c', 1, 'pending'), e('d', 2, 'weird')], meta);
    if (!built.ok) throw new Error(built.problem.reason);
    expect(built.pool.ranges).toEqual([{ entrantId: 'a', ticketStart: 1, ticketEnd: 6 }]);
    expect(built.pool.totalTickets).toBe(6);
    expect(built.excluded).toEqual({ pending: 1, revoked: 1, other: 1 });
  });

  test('zero tickets is a refusal, not an empty pool', () => {
    expect(buildPool([], meta)).toEqual({ ok: false, problem: { reason: 'poolEmpty' } });
    expect(buildPool([e('a', 1, 'revoked'), e('b', 1, 'pending')], meta)).toEqual({ ok: false, problem: { reason: 'poolEmpty' } });
  });

  test('a malformed entry refuses the whole pool: never a partial pool', () => {
    expect(buildPool([e('a', 1), e('b', 0)], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 1 } });
    expect(buildPool([e('a', 1.5)], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 0 } });
    expect(buildPool([e('', 1)], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 0 } });
    expect(buildPool([e('has/slash', 1)], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 0 } });
    expect(buildPool([{ entrantId: 'a', tickets: '2' as unknown as number, status: 'confirmed' }], meta)).toEqual({
      ok: false,
      problem: { reason: 'entryMalformed', index: 0 },
    });
  });

  test('oversize is refused before any write, against the real bound and against an override', () => {
    // Enough distinct entrants to exceed the conservative bound with the real constant.
    const many = Array.from({ length: 12_000 }, (_, i) => e(`entrant_${i.toString().padStart(6, '0')}_${'x'.repeat(20)}`, 1));
    const big = buildPool(many, meta);
    expect(big.ok).toBe(false);
    if (!big.ok) {
      expect(big.problem.reason).toBe('poolTooLarge');
      if (big.problem.reason === 'poolTooLarge') {
        expect(big.problem.maxBytes).toBe(POOL_MAX_SERIALIZED_BYTES);
        expect(big.problem.serializedBytes).toBeGreaterThan(POOL_MAX_SERIALIZED_BYTES);
      }
    }
    // A small pool passes the real bound and fails a tiny override.
    const small = buildPool([e('a', 1), e('b', 1)], meta);
    expect(small.ok).toBe(true);
    const tiny = buildPool([e('a', 1), e('b', 1)], meta, { maxSerializedBytes: 40 });
    expect(tiny.ok).toBe(false);
    if (!tiny.ok && tiny.problem.reason === 'poolTooLarge') {
      expect(tiny.problem.maxBytes).toBe(40);
      expect(tiny.problem.serializedBytes).toBe(poolSerializedBytes({ ...(small.ok ? small.pool : ({} as never)) }));
    }
    // The measured size is the size of the canonical serialization.
    if (small.ok) expect(poolSerializedBytes(small.pool)).toBe(Buffer.byteLength(canonicalPoolJson(small.pool), 'utf8'));
  });

  test('the pool record holds only the allowed fields — no source, entry, goal, uid, count or member time', () => {
    const uid = 'member_uid_12345';
    const goalId = 'goal_abc';
    const attemptId = 'attempt_xyz';
    // Entrant ids are opaque; the entries' own ids (which embed the uid) are not inputs.
    const built = buildPool([e('opaqueA', 1), e('opaqueB', 2)], meta);
    if (!built.ok) throw new Error(built.problem.reason);
    expect(Object.keys(built.pool).sort()).toEqual(
      ['enabledConfigDigest', 'entrantCount', 'poolDigest', 'poolVersion', 'ranges', 'ruleVersion', 'totalTickets'].sort()
    );
    for (const r of built.pool.ranges) expect(Object.keys(r).sort()).toEqual(['entrantId', 'ticketEnd', 'ticketStart']);
    const strings = deepStrings(built.pool);
    for (const s of strings) {
      expect(s).not.toContain(uid);
      expect(s).not.toContain(goalId);
      expect(s).not.toContain(attemptId);
      expect(s).not.toMatch(/^c_|^f_|^b_/);
      expect(s).not.toContain('@');
    }
  });
});
