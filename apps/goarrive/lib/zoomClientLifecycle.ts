/** Single browser owner. A timed-out SDK remains quarantined until its late work is cleaned up. */
let occupied = false;
export const SDK_TIMEOUT_MS = 10000;
export function bounded<T>(promise: Promise<T>, milliseconds = SDK_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Video operation timed out.')), milliseconds);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
export function createZoomLease(create: () => { client: any; destroy: () => void | Promise<void> }) {
  if (occupied) throw new Error('The previous video session is still closing. Please retry.');
  const { client, destroy } = create(); occupied = true;
  let cancelled = false; let pending: Promise<void> = Promise.resolve(); let finished: Promise<void> | undefined;
  const leave = async () => { try { await bounded(Promise.resolve().then(() => client.leaveMeeting?.()), 2000); return true; } catch { return false; } };
  const dispose = async () => { try { await bounded(Promise.resolve().then(destroy), 2000); return true; } catch { return false; } };
  return {
    get cancelled() { return cancelled; },
    run(operation: (isCurrent: () => boolean) => Promise<void>) {
      if (cancelled) return Promise.reject(new Error('Video session has closed.'));
      pending = Promise.resolve().then(() => operation(() => !cancelled));
      return bounded(pending).catch(error => { cancelled = true; throw error; });
    },
    close() {
      cancelled = true;
      if (!finished) finished = (async () => {
        await leave();
        let settled = true;
        try { await bounded(pending.catch(() => {}), 2000); } catch { settled = false; }
        await leave(); const destroyed = await dispose();
        if (settled && destroyed) occupied = false;
        else {
          // Do not allow a fresh SDK owner while an old join may still resolve.
          // UI teardown is bounded; a stuck SDK requires a page reload.
          void pending.catch(() => {}).then(async () => { await leave(); if (await dispose()) occupied = false; });
        }
      })();
      return finished;
    },
  };
}
/** Does not enumerate devices, load an SDK, or request capture permission. */
export function videoCapability() {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
