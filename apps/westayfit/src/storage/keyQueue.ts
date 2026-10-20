/**
 * Per-key operation queue for records behind the asynchronous storage
 * boundary.
 *
 * WHY A QUEUE. localStorage was synchronous, so "read the record, then write
 * it" could not be interleaved with anything. AsyncStorage is not: an await
 * between the read and the write is exactly where another operation on the
 * same record can land. Every operation queued on a key runs strictly after
 * the previous one on that key has finished, in the order it was called, so a
 * conditional update or clear is as atomic within this process as it was
 * when storage was synchronous.
 *
 * WHY A TIME BOUND. A storage call that never settles would otherwise hold
 * its key's queue forever: every later read, write and clear of that record
 * would wait behind it, and so would any screen waiting on them. Each
 * operation is therefore bounded. When the bound passes, the operation
 * answers with its caller's `timedOut()` value — which must be the honest
 * "not done" answer (a write reports not durable, a read reports unreadable)
 * — and the queue moves on.
 *
 * What the bound cannot do is cancel the device call. If a timed-out write
 * later completes, it lands then, possibly after operations queued behind
 * it. That is the residual; it needs a device that hangs a storage call for
 * longer than the bound and then completes it.
 */
export const STORAGE_OP_TIMEOUT_MS = 5_000;

export type KeyQueue = <T>(key: string, op: () => Promise<T>, timedOut: () => T) => Promise<T>;

function bounded<T>(op: () => Promise<T>, ms: number, timedOut: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        resolve(timedOut());
      } catch (e) {
        reject(e);
      }
    }, ms);
    let running: Promise<T>;
    try {
      running = op();
    } catch (e) {
      running = Promise.reject(e);
    }
    running.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createKeyQueue(timeoutMs: number = STORAGE_OP_TIMEOUT_MS): KeyQueue {
  const queues = new Map<string, Promise<unknown>>();
  return <T>(key: string, op: () => Promise<T>, timedOut: () => T): Promise<T> => {
    const prev = queues.get(key) ?? Promise.resolve();
    const run = prev.then(() => bounded(op, timeoutMs, timedOut));
    // The queue's tail never rejects, so one failed operation cannot stop the
    // ones behind it.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  };
}
