/**
 * Run an async job over each item, at most `limit` at a time, and never reject.
 *
 * The Community screen reads goals for every community a member belongs to.
 * Serially that is an N+1 chain whose latency grows with membership count;
 * unbounded it is a burst of callables that arrives all at once from a phone
 * on a hotel network. Bounded parallelism is the only shape that is neither.
 *
 * EVERY JOB'S FAILURE IS ITS OWN. A settled result is returned per item, so
 * one community whose goals will not load cannot empty the whole screen — the
 * caller decides what a failed item looks like. That is a product requirement
 * here, not a convenience: the list is the member's way back to the community
 * they were in, and it has to survive one bad read.
 *
 * Order is preserved: results[i] always belongs to items[i], whatever order
 * the jobs finish in.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function mapWithLimit<In, Out>(
  items: readonly In[],
  limit: number,
  job: (item: In, index: number) => Promise<Out>,
): Promise<Array<Settled<Out>>> {
  const results = new Array<Settled<Out>>(items.length);
  if (items.length === 0) return results;

  // A limit below one would start nothing at all and hang forever.
  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await job(items[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
