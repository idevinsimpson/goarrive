/**
 * EXPO PRIZE — the immutable, privacy-safe ticket pool. PURE: no I/O.
 *
 * The pool is what a later draw would select over, and nothing else. It is
 * built from the confirmed entries, aggregated by OPAQUE entrant id, sorted
 * canonically, and laid out as contiguous ticket ranges from 1. The same
 * entries in any order give byte-identical output and the same digest; that
 * is what lets concurrent finalizers agree and a retry replay.
 *
 * WHAT IT NEVER HOLDS: a uid, a name, an email, a contact, a contribution /
 * source / attempt / entry id (those embed the uid by construction — the
 * canonical contribution key is `{goalId}_{uid}_{attemptId}`), a goal id,
 * a member's own timestamp, or a movement count. The entrant id is the random
 * opaque id the award minted; the only place it meets a uid is the link
 * document, which the pool does not read.
 *
 * There is no draw here. No random selection, no prize, no winner.
 */
import { createHash } from 'crypto';

/** Schema version of the pool record; part of the digest. */
export const POOL_VERSION = 1;

/**
 * Conservative serialized-size bound on the pool payload (UTF-8 bytes of
 * the canonical JSON). Firestore's document limit is 1 MiB; the stored
 * document also carries field names, the digest and server metadata, so the
 * bound is set well under it and refused BEFORE any write.
 */
export const POOL_MAX_SERIALIZED_BYTES = 512 * 1024;

/** One confirmed entry as the pool builder needs it: who (opaque) and how many. */
export type PoolEntryInput = {
  entrantId: string;
  tickets: number;
  status: 'confirmed' | 'pending' | 'revoked' | string;
};

export type TicketRange = {
  entrantId: string;
  /** Inclusive, 1-based. */
  ticketStart: number;
  /** Inclusive. */
  ticketEnd: number;
};

/** The frozen pool as stored under wsfPromotionPools/{promotionId} (minus server fields). */
export type PoolRecord = {
  poolVersion: number;
  ruleVersion: number;
  enabledConfigDigest: string;
  totalTickets: number;
  entrantCount: number;
  ranges: TicketRange[];
  poolDigest: string;
};

export type PoolBuildProblem =
  | { reason: 'poolEmpty' }
  | { reason: 'poolTooLarge'; serializedBytes: number; maxBytes: number }
  | { reason: 'entryMalformed'; index: number };

export type PoolBuild =
  | { ok: true; pool: PoolRecord; serializedBytes: number; excluded: { pending: number; revoked: number; other: number } }
  | { ok: false; problem: PoolBuildProblem };

const ENTRANT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The digest of a pool is the digest of exactly what a draw would read:
 * version, rule version, the enablement digest, the total, and the ranges in
 * canonical order. Server timestamps and the attempt id are not part of it.
 */
export function poolDigest(pool: Omit<PoolRecord, 'poolDigest'>): string {
  return createHash('sha256').update(canonicalPoolJson(pool)).digest('hex');
}

/** The canonical serialization: fixed field order, ranges as compact triples. */
export function canonicalPoolJson(pool: Omit<PoolRecord, 'poolDigest'>): string {
  return JSON.stringify({
    poolVersion: pool.poolVersion,
    ruleVersion: pool.ruleVersion,
    enabledConfigDigest: pool.enabledConfigDigest,
    totalTickets: pool.totalTickets,
    entrantCount: pool.entrantCount,
    ranges: pool.ranges.map((r) => [r.entrantId, r.ticketStart, r.ticketEnd]),
  });
}

/** UTF-8 byte length of the canonical serialization: the size the bound is applied to. */
export function poolSerializedBytes(pool: Omit<PoolRecord, 'poolDigest'>): number {
  return Buffer.byteLength(canonicalPoolJson(pool), 'utf8');
}

/**
 * Build the pool from entries. Deterministic: the entries may arrive in any
 * order. Only `confirmed` entries carry tickets; `pending` (paper, next
 * phase) and `revoked` entries are excluded and counted. Zero tickets is a
 * refusal (`poolEmpty`), not an empty pool; an oversize pool is refused
 * (`poolTooLarge`) with the measured size, before anything is written.
 */
export function buildPool(
  entries: readonly PoolEntryInput[],
  meta: { ruleVersion: number; enabledConfigDigest: string },
  opts: { maxSerializedBytes?: number } = {}
): PoolBuild {
  const maxBytes = opts.maxSerializedBytes ?? POOL_MAX_SERIALIZED_BYTES;
  const perEntrant = new Map<string, number>();
  const excluded = { pending: 0, revoked: 0, other: 0 };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (
      !e ||
      typeof e.entrantId !== 'string' ||
      !ENTRANT_ID_RE.test(e.entrantId) ||
      typeof e.tickets !== 'number' ||
      !Number.isInteger(e.tickets) ||
      e.tickets < 1
    ) {
      return { ok: false, problem: { reason: 'entryMalformed', index: i } };
    }
    if (e.status !== 'confirmed') {
      if (e.status === 'pending') excluded.pending += 1;
      else if (e.status === 'revoked') excluded.revoked += 1;
      else excluded.other += 1;
      continue;
    }
    perEntrant.set(e.entrantId, (perEntrant.get(e.entrantId) ?? 0) + e.tickets);
  }

  const entrantIds = [...perEntrant.keys()].sort(byCodeUnit);
  const ranges: TicketRange[] = [];
  let next = 1;
  for (const entrantId of entrantIds) {
    const tickets = perEntrant.get(entrantId) as number;
    ranges.push({ entrantId, ticketStart: next, ticketEnd: next + tickets - 1 });
    next += tickets;
  }
  const totalTickets = next - 1;
  if (totalTickets < 1) return { ok: false, problem: { reason: 'poolEmpty' } };

  const body = {
    poolVersion: POOL_VERSION,
    ruleVersion: meta.ruleVersion,
    enabledConfigDigest: meta.enabledConfigDigest,
    totalTickets,
    entrantCount: ranges.length,
    ranges,
  };
  const serializedBytes = poolSerializedBytes(body);
  if (serializedBytes > maxBytes) {
    return { ok: false, problem: { reason: 'poolTooLarge', serializedBytes, maxBytes } };
  }
  return { ok: true, pool: { ...body, poolDigest: poolDigest(body) }, serializedBytes, excluded };
}

/**
 * Re-derive the digest of a stored pool from its own ranges and compare. A
 * pool whose stored digest does not match its content has been edited.
 */
export function storedPoolIntact(raw: unknown): raw is PoolRecord {
  if (!raw || typeof raw !== 'object') return false;
  const d = raw as Record<string, unknown>;
  if (typeof d.poolDigest !== 'string') return false;
  if (!Array.isArray(d.ranges)) return false;
  const ranges: TicketRange[] = [];
  for (const r of d.ranges as unknown[]) {
    const x = (r ?? {}) as Record<string, unknown>;
    if (typeof x.entrantId !== 'string' || typeof x.ticketStart !== 'number' || typeof x.ticketEnd !== 'number') return false;
    ranges.push({ entrantId: x.entrantId, ticketStart: x.ticketStart, ticketEnd: x.ticketEnd });
  }
  if (
    typeof d.poolVersion !== 'number' ||
    typeof d.ruleVersion !== 'number' ||
    typeof d.enabledConfigDigest !== 'string' ||
    typeof d.totalTickets !== 'number' ||
    typeof d.entrantCount !== 'number'
  ) {
    return false;
  }
  const recomputed = poolDigest({
    poolVersion: d.poolVersion,
    ruleVersion: d.ruleVersion,
    enabledConfigDigest: d.enabledConfigDigest,
    totalTickets: d.totalTickets,
    entrantCount: d.entrantCount,
    ranges,
  });
  return recomputed === d.poolDigest;
}
