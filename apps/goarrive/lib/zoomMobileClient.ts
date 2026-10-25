export function needsMobileZoomClient(nav = typeof navigator === 'undefined' ? undefined : navigator) {
  return !!nav && (/Android|iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
}

/** Client View is isolated from Expo CSS/React. No credentials enter a URL or storage. */
export function createMobileZoomClient(root: HTMLElement, onEnded: () => void) {
  const frame = document.createElement('iframe');
  frame.title = 'Zoom meeting controls'; frame.src = '/workout-zoom-client.html';
  frame.allow = 'camera; microphone; autoplay; fullscreen'; frame.referrerPolicy = 'no-referrer';
  Object.assign(frame.style, { border: '0', width: '100%', height: '100%' });
  let closed = false, started = false, rejectJoin: ((error: unknown) => void) | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  let resolveJoin: (() => void) | undefined;
  const receive = (event: MessageEvent) => {
    if (closed || event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type === 'workout-zoom-ready') resolveReady();
    if (data?.type === 'workout-zoom-joined') resolveJoin?.();
    if (data?.type === 'workout-zoom-error') rejectJoin?.({ errorCode: typeof data.code === 'number' ? data.code : undefined });
    if (data?.type === 'workout-zoom-left') { rejectJoin?.(new Error('Video session ended')); onEnded(); }
  };
  window.addEventListener('message', receive);
  root.appendChild(frame);
  const destroy = () => {
    if (closed) return;
    closed = true; window.removeEventListener('message', receive);
    rejectJoin?.(new Error('Video session closed')); resolveReady();
    // Removing the isolated browsing context also terminates its media on hung SDK teardown.
    frame.remove();
  };
  return {
    client: {
      init: async () => {},
      join: async (config: Record<string, unknown>) => {
        if (closed || started) throw new Error('Video session unavailable');
        started = true;
        const result = new Promise<void>((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
        await ready;
        if (closed) return result;
        frame.contentWindow?.postMessage({ type: 'workout-zoom-join', config: {
          signature: config.signature, meetingNumber: config.meetingNumber, passWord: config.password || '',
          userName: config.userName || 'Member', userEmail: config.userEmail || '',
        } }, window.location.origin);
        return result;
      },
      leaveMeeting: async () => { destroy(); },
    },
    destroy,
  };
}
