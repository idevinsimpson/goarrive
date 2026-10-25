/** Rendering-only recovery. Never starts media, joins a meeting, or reads video pixels. */
export function watchZoomSelfView(client: any, root: HTMLElement, reportCamera: (on: boolean | null) => void) {
  let closed = false;
  let frame: number | null = null;
  let camera: boolean | null = null;
  let lastSize = '';
  const refresh = () => {
    if (closed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (closed || !root.isConnected || root.getClientRects().length === 0) return;
      const bounds = root.getBoundingClientRect();
      const width = root.clientWidth || bounds.width;
      const height = root.clientHeight || bounds.height;
      if (width <= 0 || height <= 0) return;
      try {
        client.updateVideoOptions?.({ viewSizes: { default: { width: Math.round(width), height: Math.round(height) } } });
      } catch { /* A rendering failure must not stop the workout or change media consent. */ }
    });
  };
  const observeCamera = () => {
    if (closed) return;
    let next: boolean | null = null;
    try { const user = client.getCurrentUser?.(); next = typeof user?.video === 'boolean' ? user.video : null; } catch {}
    if (next !== camera) { camera = next; reportCamera(next); if (next === true) refresh(); }
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    const bounds = root.getBoundingClientRect();
      const width = root.clientWidth || bounds.width;
      const height = root.clientHeight || bounds.height;
    const size = `${width}:${height}`;
    if (size !== lastSize) { lastSize = size; refresh(); }
  });
  observer?.observe(root);
  client.on?.('user-updated', observeCamera);
  observeCamera(); refresh();
  return {
    refresh,
    close() {
      closed = true; observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      try { client.off?.('user-updated', observeCamera); } catch {}
    },
  };
}
