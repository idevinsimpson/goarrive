/** One owner per browser: a delayed join must settle and leave before another can start. */
let occupied = false;
export function createZoomLease(create: () => { client: any; destroy: () => void | Promise<void> }) {
  if (occupied) throw new Error('The previous video session is still closing. Please retry.');
  const { client, destroy } = create();
  occupied = true;
  let cancelled = false;
  let pending: Promise<void> = Promise.resolve();
  let finished: Promise<void> | undefined;
  const leave = async () => { try { await client.leaveMeeting?.(); } catch { /* still destroy the local client */ } };
  return {
    get cancelled() { return cancelled; },
    run(operation: (isCurrent: () => boolean) => Promise<void>) {
      if (cancelled) return Promise.reject(new Error('Video session has closed.'));
      pending = operation(() => !cancelled);
      return pending;
    },
    close() {
      cancelled = true;
      if (!finished) {
        finished = (async () => {
          // Stop an already joined client immediately, then catch a join that resolves late.
          await leave();
          try { await pending; } catch { /* caller presents the error only while mounted */ }
          await leave();
          try { await destroy(); } finally { occupied = false; }
        })();
      }
      return finished;
    },
  };
}

/** Does not enumerate devices, load an SDK, or request capture permission. */
export function videoCapability() {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
