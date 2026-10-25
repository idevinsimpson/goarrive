/* Standalone Client View: intentionally no Firebase, app telemetry, storage or URL credentials. */
(() => {
  'use strict';
  if (window.parent === window) return;
  const origin = window.location.origin, version = '5.1.4';
  let started = false, closed = false;
  const send = (type, extra = {}) => { if (!closed) window.parent.postMessage({ type, ...extra }, origin); };
  const numericCode = e => typeof e?.errorCode === 'number' && Number.isSafeInteger(e.errorCode) ? e.errorCode : undefined;
  const script = src => new Promise((resolve, reject) => {
    const node = document.createElement('script'); node.src = src;
    const timer = setTimeout(() => { node.remove(); reject(new Error('Download timeout')); }, 20000);
    node.onload = () => { clearTimeout(timer); resolve(); };
    node.onerror = () => { clearTimeout(timer); node.remove(); reject(new Error('Download failed')); };
    document.head.appendChild(node);
  });
  const invoke = (sdk, method, args) => new Promise((resolve, reject) => {
    const result = sdk[method]({ ...args, success: resolve, error: reject });
    if (result?.then) result.then(resolve, reject);
  });
  window.addEventListener('pagehide', () => { closed = true; });
  window.addEventListener('message', async event => {
    if (closed || started || event.origin !== origin || event.source !== window.parent || event.data?.type !== 'workout-zoom-join') return;
    const config = event.data.config;
    if (!config || typeof config.signature !== 'string' || typeof config.meetingNumber !== 'string' || typeof config.userName !== 'string') return;
    started = true;
    document.getElementById('status').textContent = 'Loading Zoom…';
    try {
      // Pinned 5.1.4 externals; React Redux is bundled (its standalone CDN URL is unavailable).
      // All globals remain inside this document rather than colliding with Expo React.
      for (const name of ['react', 'react-dom', 'redux', 'redux-thunk', 'lodash']) {
        if (closed) return;
        await script(`https://source.zoom.us/${version}/lib/vendor/${name}.min.js`);
      }
      if (closed) return;
      await script(`https://source.zoom.us/zoom-meeting-${version}.min.js`);
      if (closed) return;
      const sdk = window.ZoomMtg;
      sdk.setZoomJSLib(`https://source.zoom.us/${version}/lib`, '/av');
      sdk.preLoadWasm(); sdk.prepareWebSDK();
      await invoke(sdk, 'init', {
        leaveUrl: `${origin}/workout-zoom-left.html`, leaveOnPageUnload: true,
        patchJsMedia: true, debug: false, disablePreview: true, enableWaitingRoomPreview: false,
        audioPanelAlwaysOpen: false, defaultView: 'speaker', screenShare: false,
        disableInvite: true, meetingInfo: [],
      });
      if (closed) return;
      await invoke(sdk, 'join', config);
      if (closed) return;
      document.getElementById('status').style.display = 'none';
      send('workout-zoom-joined');
    } catch (error) {
      document.getElementById('status').textContent = 'Video could not connect. Return to your workout to retry.';
      send('workout-zoom-error', { code: numericCode(error) });
    }
  });
  send('workout-zoom-ready');
})();
