// Pinned to the officially recommended Chrome WebRTC compatibility baseline.
const ZOOM_SDK_VERSION = '5.1.4';
const ZOOM_SDK_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;

const scripts = new Map<string, Promise<void>>();
function ensureScript(src: string): Promise<void> {
  const prior = scripts.get(src); if (prior) return prior;
  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('Browser required')); return; }
    const el = document.createElement('script'); el.src = src; el.async = true;
    const timer = setTimeout(() => { el.remove(); reject(new Error('Video download timed out.')); }, 20000);
    el.onload = () => { clearTimeout(timer); resolve(); };
    el.onerror = () => { clearTimeout(timer); el.remove(); reject(new Error('Video download failed.')); };
    document.head.appendChild(el);
  });
  scripts.set(src, promise);
  void promise.catch(() => { if (scripts.get(src) === promise) scripts.delete(src); });
  return promise;
}
let loadedSdk: any;
export async function loadZoomEmbedded(): Promise<any> {
  if (loadedSdk) return loadedSdk;
  if ((globalThis as any).ZoomMtgEmbedded) throw new Error('Reload this page before using the updated video client.');
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react-dom.min.js`);
  await ensureScript(`https://source.zoom.us/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
  const ZoomMtgEmbedded = (globalThis as any).ZoomMtgEmbedded;
  if (!ZoomMtgEmbedded) throw new Error('ZoomMtgEmbedded not available after load');
  loadedSdk = ZoomMtgEmbedded;
  return loadedSdk;
}

