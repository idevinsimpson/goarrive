/** No overlapping checks; an expired admission closes media even when a request hangs. */
export function watchVideoAdmission<T>(read: () => Promise<T>, accept: (value: T) => void, deny: () => void, interval = 15000, lifetime = 25000, validFor: (value: T) => number = () => lifetime) {
  let stopped = false; let expiry: ReturnType<typeof setTimeout> | undefined; let next: ReturnType<typeof setTimeout> | undefined;
  const expire = () => { if (!stopped) deny(); };
  const refresh = async () => {
    const started = performance.now();
    try {
      const value = await read();
      if (stopped) return;
      if (expiry) clearTimeout(expiry);
      const remaining = Math.max(0, Math.min(lifetime, validFor(value)) - (performance.now() - started));
      if (!remaining) deny();
      else { accept(value); expiry = setTimeout(expire, remaining); }
    } catch { if (!stopped) deny(); }
    finally { if (!stopped) next = setTimeout(() => { void refresh(); }, interval); }
  };
  expiry = setTimeout(expire, lifetime); void refresh();
  return () => { stopped = true; if (expiry) clearTimeout(expiry); if (next) clearTimeout(next); };
}
