import { GuestMediaClient } from './guestMediaClient';

type Step = { name: string; prescription: string; video?: string; thumbnail?: string };
/** Isolated DOM player: no Expo, Firebase, analytics, completion, voice or Zoom.
 * Enabled is only supplied by the local fixture build; shipped shell is false. */
export function mountGuestWorkoutShell(root: HTMLElement, options: { enabled?: boolean } = {}) {
  let token = /^#key=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1] || '';
  // Synchronous and before constructing the client, rendering or making requests.
  history.replaceState(null, '', location.pathname);
  root.replaceChildren();
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = document.createElement(tag); node.textContent = text; return node;
  };
  root.append(element('h1', 'Guest workout'));
  const status = element('p'); status.setAttribute('role', 'status'); root.append(status);
  const panel = element('section'); root.append(panel);
  if (!options.enabled || !token) {
    token = ''; status.textContent = options.enabled ? 'This workout link is unavailable. Open the original link from your coach.' : 'Guest playback is not available yet. Use your Member Workout Link and sign in.';
    return () => {};
  }
  let closed = false, generation = 0, index = 0, busy = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let client: GuestMediaClient;
  let mediaUrl: string | undefined;
  const video = element('video'); video.controls = true; video.playsInline = true; video.preload = 'none';
  video.setAttribute('aria-label', 'Workout movement video'); video.setAttribute('controlsList', 'nodownload noremoteplayback'); video.disablePictureInPicture = true;
  const image = element('img'); image.alt = 'Movement preview'; image.hidden = true;
  const clearMedia = () => {
    video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
    image.removeAttribute('src'); image.hidden = true;
    if (mediaUrl) client?.release(mediaUrl); mediaUrl = undefined;
  };
  const close = () => {
    if (closed) return;
    closed = true; generation++; token = ''; if (renewal) clearTimeout(renewal);
    clearMedia(); client?.close(); panel.replaceChildren();
    status.textContent = 'Workout closed or access unavailable. Open the original link from your coach to try again.';
    window.removeEventListener('pagehide', close);
    window.removeEventListener('popstate', navigate);
    window.removeEventListener('hashchange', navigate);
    document.removeEventListener('visibilitychange', visibility);
  };
  const navigate = () => { history.replaceState(null, '', location.pathname); close(); };
  const visibility = () => { if (document.hidden) close(); };
  window.addEventListener('pagehide', close);
  window.addEventListener('popstate', navigate);
  window.addEventListener('hashchange', navigate);
  document.addEventListener('visibilitychange', visibility);
  client = new GuestMediaClient(token, fetch, () => performance.now(), close); token = '';
  status.textContent = 'Loading your scheduled workout…';
  const parse = (manifest: any): Step[] => {
    if (!Array.isArray(manifest.assets) || manifest.assets.length > 700 || !Array.isArray(manifest.workout?.blocks) || manifest.workout.blocks.length > 60) throw new Error();
    const assets = new Map<string, string>();
    for (const a of manifest.assets) {
      if (!a || !/^asset-\d{1,4}$/.test(a.id) || !['video', 'image'].includes(a.kind) || assets.has(a.id)) throw new Error();
      assets.set(a.id, a.kind);
    }
    const asset = (id: unknown, kind: string) => { if (id == null) return undefined; if (typeof id !== 'string' || assets.get(id) !== kind) throw new Error(); return id; };
    const label = (value: unknown) => typeof value === 'string' ? value.slice(0, 120) : '';
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3600 ? value : 0;
    const steps: Step[] = [];
    for (const block of manifest.workout.blocks) {
      if (!block || !Array.isArray(block.movements)) throw new Error();
      if (block.videoAsset) steps.push({ name: label(block.type), prescription: `${number(block.durationSec)} seconds`, video: asset(block.videoAsset, 'video') });
      for (const m of block.movements) {
        if (!m || steps.length >= 360) throw new Error();
        steps.push({ name: label(m.name) || 'Movement', prescription: `${m.sets == null ? '' : number(m.sets) + ' sets · '}${label(m.reps) ? label(m.reps) + ' reps · ' : ''}${number(m.workSec)} seconds · ${number(m.restSec)} seconds rest`, video: asset(m.videoAsset, 'video'), thumbnail: asset(m.thumbnailAsset, 'image') });
      }
      if (!block.videoAsset && !block.movements.length) steps.push({ name: label(block.type), prescription: `${number(block.durationSec)} seconds` });
    }
    if (!steps.length || steps.length > 360) throw new Error(); return steps;
  };
  const renew = async () => {
    try { await client.manifest(); if (!closed) renewal = setTimeout(renew, 10000); } catch { close(); }
  };
  void (async () => {
    try {
      const steps = parse(await client.manifest()); if (closed) return;
      renewal = setTimeout(renew, 10000);
      const heading = element('h2'), prescription = element('p'), count = element('p');
      const play = element('button', 'Play movement video'), previous = element('button', 'Previous movement'), next = element('button', 'Next movement'), exit = element('button', 'Close workout');
      const notice = element('p', 'Read-only workout. Completion is not saved. Voice, music and video calls are unavailable.');
      panel.append(count, heading, prescription, image, video, play, previous, next, exit, notice);
      const show = async () => {
        const current = ++generation; clearMedia(); busy = false;
        const step = steps[index]; count.textContent = `Movement ${index + 1} of ${steps.length}`; heading.textContent = step.name; prescription.textContent = step.prescription;
        previous.disabled = index === 0; next.disabled = index === steps.length - 1; play.disabled = !step.video;
        status.textContent = 'Ready. Choose Play movement video when you are ready.';
        if (step.thumbnail) {
          try {
            const url = await client.asset(step.thumbnail);
            if (closed || current !== generation) { client.release(url); return; }
            mediaUrl = url; image.src = url; image.hidden = false;
          } catch { close(); }
        }
      };
      play.onclick = async () => {
        if (closed || busy || !steps[index].video) return;
        busy = true; play.disabled = true; const current = ++generation; clearMedia(); status.textContent = 'Loading movement video…';
        try {
          const url = await client.asset(steps[index].video!);
          if (closed || current !== generation) { client.release(url); return; }
          mediaUrl = url; video.src = url; video.hidden = false; status.textContent = 'Use the video controls to pause or seek.';
          try { await video.play(); } catch { if (!closed && current === generation) status.textContent = 'Press Play in the video controls to begin.'; }
        } catch { close(); }
        finally { if (!closed && current === generation) { busy = false; play.disabled = false; } }
      };
      video.onerror = () => { if (!closed && video.hasAttribute('src')) close(); };
      previous.onclick = () => { if (index > 0) { index--; void show(); } };
      next.onclick = () => { if (index < steps.length - 1) { index++; void show(); } };
      exit.onclick = close; await show();
    } catch { close(); }
  })();
  return close;
}
