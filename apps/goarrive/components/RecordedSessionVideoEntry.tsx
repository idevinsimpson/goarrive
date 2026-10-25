import React, { useEffect, useState, useRef } from 'react';
import { Text } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import SessionZoomTile from './SessionZoomTile';
/** Preserve legacy entry outside recorded tests; never mount it while routing is unknown. */
export default function RecordedSessionVideoEntry({ sessionInstanceId, variant }: { sessionInstanceId: string; variant: 'pip' | 'pane' }) {
  const { user } = useAuth();
  const [route, setRoute] = useState<{ key: string; value: 'legacy' | 'consent' | 'error' } | null>(null);
  const key = `${user?.uid}:${sessionInstanceId}`;
  const activeKey = useRef(key); activeKey.current = key;
  const beforeJoin = async () => {
    try {
      const { data } = await httpsCallable<any, { recordingConsentRequired?: boolean }>(functions, 'getSessionVideoAvailability')({ sessionInstanceId });
      if (activeKey.current !== key) return false;
      const consent = data.recordingConsentRequired === true;
      setRoute({ key, value: consent ? 'consent' : 'legacy' });
      return !consent;
    } catch { if (activeKey.current === key) setRoute({ key, value: 'error' }); return false; }
  };
  useEffect(() => {
    let current = true; activeKey.current = key;
    if (user) void httpsCallable<any, { recordingConsentRequired?: boolean }>(functions, 'getSessionVideoAvailability')({ sessionInstanceId }).then(({ data }) => {
      if (current) setRoute({ key, value: data.recordingConsentRequired === true ? 'consent' : 'legacy' });
    }).catch(() => { if (current) setRoute({ key, value: 'error' }); });
    return () => { current = false; if (activeKey.current === key) activeKey.current = ''; };
  }, [key]);
  if (!user || route?.key !== key) return null;
  if (route.value === 'legacy') return <SessionZoomTile sessionInstanceId={sessionInstanceId} variant={variant} beforeJoin={beforeJoin} />;
  return <Text style={{ color: '#A0AEC0' }}>{route.value === 'consent' ? 'Start your workout to review recording and join video inside the player.' : 'Video status could not load. Refresh to retry; your workout remains available.'}</Text>;
}
