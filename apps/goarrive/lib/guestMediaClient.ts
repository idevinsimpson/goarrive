/** Draft-only adapter. No production endpoint or issuance UI is wired to it.
 * Capabilities stay in memory and headers; media is never fetched from a URL in
 * workout data. No authentication cookies, persistence, telemetry or writes. */
export class GuestMediaClient {
  private closed = false;
  private controller = new AbortController();
  private urls = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline = 0;
  private revision = '';
  private checking: Promise<any> | undefined;
  constructor(private token: string, private transport: typeof fetch = fetch,
    private clock = () => performance.now(), private onUnavailable = () => {}) {}
  close() {
    if (this.closed) return;
    this.closed = true; this.token = ''; this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear(); this.onUnavailable();
  }
  private async request(action: 'manifest' | 'chunk', body: object, range?: string) {
    if (this.closed) throw new Error('Workout unavailable.');
    const controller = new AbortController(), abort = () => controller.abort();
    this.controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 10000);
    try {
      const transport = this.transport;
      const response = await transport('/guest-workout-api/' + action, {
        method: 'POST', mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: controller.signal, headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json', ...(range ? { Range: range } : {}) }, body: JSON.stringify(body),
      });
      if (!response.ok || this.closed) throw new Error('Workout unavailable.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Workout unavailable.');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > (action === 'chunk' ? 1024 * 1024 : 128 * 1024) || this.closed || controller.signal.aborted) throw new Error();
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (this.closed || controller.signal.aborted) throw new Error();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return new Response(bytes, { status: response.status, headers: response.headers });
    } catch { this.close(); throw new Error('Workout unavailable.'); }
    finally { clearTimeout(timeout); this.controller.signal.removeEventListener('abort', abort); }
  }
  /** Single-flight renewal; old expiry timer continues while requests are slow. */
  manifest(): Promise<any> {
    if (this.checking) return this.checking;
    const started = this.clock();
    this.checking = (async () => {
      try {
        const value = await (await this.request('manifest', {})).json();
        const remaining = Math.min(25000, value.validUntil - value.serverNow) - (this.clock() - started);
        if (this.closed || !Number.isFinite(remaining) || remaining <= 0 || !/^[a-f0-9]{64}$/.test(value.revision) || (this.revision && this.revision !== value.revision)) throw new Error();
        this.revision = value.revision; this.deadline = this.clock() + remaining;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.close(), remaining);
        return value;
      } catch { this.close(); throw new Error('Workout unavailable.'); }
      finally { this.checking = undefined; }
    })();
    return this.checking;
  }
  async asset(id: string) {
    if (!/^asset-\d{1,4}$/.test(id) || !this.revision || this.clock() >= this.deadline) { this.close(); throw new Error('Workout unavailable.'); }
    try {
      const parts: ArrayBuffer[] = []; let total = 1, start = 0, contentType = '';
      while (start < total) {
        const end = start === 0 ? 0 : Math.min(total - 1, start + 1024 * 1024 - 1);
        const response = await this.request('chunk', { assetId: id, revision: this.revision }, `bytes=${start}-${end}`);
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
        const type = response.headers.get('Content-Type') || '';
        if (!match || +match[1] !== start || +match[2] !== end || +match[3] < 1 || +match[3] > 25 * 1024 * 1024 ||
          (start > 0 && (+match[3] !== total || type !== contentType)) || !/^(video\/(mp4|webm)|image\/(png|jpeg|gif|webp))$/.test(type)) throw new Error();
        total = +match[3]; contentType = type;
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== end - start + 1 || this.closed || this.clock() >= this.deadline) throw new Error();
        parts.push(bytes); start = end + 1;
      }
      const url = URL.createObjectURL(new Blob(parts, { type: contentType })); this.urls.add(url); return url;
    } catch { this.close(); throw new Error('Workout unavailable.'); }
  }
}
