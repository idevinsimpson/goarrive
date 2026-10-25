import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { monotonicNow, observeServerClock, serverClockNow, ServerClock } from '../lib/serverClock';

export function useSessionServerTime(sessionId: string, uid: string | undefined) {
  const identity = `${uid || ''}/${sessionId}`;
  const [sample, setSample] = useState<{ identity: string; now: number | null }>({ identity: '', now: null });
  const [retry, setRetry] = useState(0);
  const clock = useRef<ServerClock | null>(null);
  useEffect(() => {
    let stopped = false, busy = false;
    clock.current = null;
    setSample({ identity, now: null });
    if (!uid || !sessionId) return;
    async function refresh() {
      if (stopped || busy) return;
      busy = true;
      const sentAt = monotonicNow();
      try {
        const response = await httpsCallable<{ sessionInstanceId: string }, { serverNow: number }>(functions, 'getSessionTime')({ sessionInstanceId: sessionId });
        if (stopped) return;
        clock.current = observeServerClock(response.data.serverNow, sentAt);
        setSample({ identity, now: serverClockNow(clock.current) });
      } catch {
        if (!stopped) { clock.current = null; setSample({ identity, now: null }); }
      } finally { busy = false; }
    }
    void refresh();
    const tick = setInterval(() => setSample({ identity, now: serverClockNow(clock.current) }), 1000);
    const poll = setInterval(refresh, 30000);
    const resume = () => { clock.current = null; setSample({ identity, now: null }); void refresh(); };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    if (typeof window !== 'undefined') window.addEventListener('focus', resume);
    return () => { stopped = true; clearInterval(tick); clearInterval(poll); subscription.remove(); if (typeof window !== 'undefined') window.removeEventListener('focus', resume); };
  }, [identity, retry]);
  return { now: sample.identity === identity ? sample.now : null, refreshTime: () => setRetry(v => v + 1) };
}
