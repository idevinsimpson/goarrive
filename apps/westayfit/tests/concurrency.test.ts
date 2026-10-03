import { describe, expect, it } from 'vitest';

import { mapWithLimit } from '../src/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('mapWithLimit', () => {
  it('returns results in input order, whatever order the jobs finish in', async () => {
    const out = await mapWithLimit([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([
      { ok: true, value: 30 },
      { ok: true, value: 10 },
      { ok: true, value: 20 },
    ]);
  });

  it('never runs more than `limit` jobs at once', async () => {
    let running = 0;
    let peak = 0;
    await mapWithLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return null;
    });
    expect(peak).toBe(3);
  });

  it('isolates a failure: one bad job does not reject the whole call', async () => {
    const out = await mapWithLimit(['a', 'boom', 'c'], 2, async (v) => {
      if (v === 'boom') throw new Error('nope');
      return v.toUpperCase();
    });
    expect(out[0]).toEqual({ ok: true, value: 'A' });
    expect(out[1]!.ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: 'C' });
  });

  it('still completes every remaining job after one fails', async () => {
    const seen: number[] = [];
    const out = await mapWithLimit([0, 1, 2, 3, 4], 2, async (i) => {
      seen.push(i);
      if (i === 1) throw new Error('nope');
      return i;
    });
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(out.filter((r) => r.ok)).toHaveLength(4);
  });

  it('handles an empty list without starting a worker', async () => {
    let calls = 0;
    const out = await mapWithLimit([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('a limit of zero or less still makes progress rather than hanging', async () => {
    const out = await mapWithLimit([1, 2], 0, async (v) => v * 2);
    expect(out).toEqual([
      { ok: true, value: 2 },
      { ok: true, value: 4 },
    ]);
  });

  it('never opens more workers than there are items', async () => {
    let peak = 0;
    let running = 0;
    await mapWithLimit([1, 2], 16, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return null;
    });
    expect(peak).toBe(2);
  });
});
