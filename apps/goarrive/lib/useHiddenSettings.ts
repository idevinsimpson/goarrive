/**
 * useHiddenSettings — admin-controlled visibility of account settings sections.
 *
 * Reads hiddenSettings (string[]) from coaches/{effectiveUid} via a live
 * onSnapshot so admin toggles apply instantly. Only platformAdmin may write
 * the hiddenSettings key (enforced in firestore.rules — coaches cannot
 * un-hide themselves). Missing field = nothing hidden.
 *
 * Coach-facing surfaces skip hidden sections entirely. When an admin is
 * impersonating, hidden sections still render with a "Hidden from coach" tag.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';

export const HIDEABLE_SETTINGS = [
  'stripe',
  'zoom',
  'noShowGrace',
  'skipAutoApproval',
  'icalSync',
  'googleCalendar',
  'myPage',
  'myZoomAccount',
] as const;

export type HideableSettingKey = (typeof HIDEABLE_SETTINGS)[number];

export const HIDEABLE_SETTING_LABELS: Record<HideableSettingKey, string> = {
  stripe: 'Stripe Payments',
  zoom: 'Personal Zoom',
  noShowGrace: 'No-Show Grace Period',
  skipAutoApproval: 'Skip Auto-Approval',
  icalSync: 'Sync to Calendar (iCal)',
  googleCalendar: 'Google Calendar Sync',
  myPage: 'My Page',
  myZoomAccount: 'My Zoom Account',
};

export function useHiddenSettings(): {
  hiddenSettings: string[];
  isHidden: (key: HideableSettingKey) => boolean;
  /** True when a platform admin is viewing as a coach */
  impersonating: boolean;
} {
  const { effectiveUid, adminCoachOverride } = useAuth();
  const [hiddenSettings, setHiddenSettings] = useState<string[]>([]);

  useEffect(() => {
    if (!effectiveUid) {
      setHiddenSettings([]);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'coaches', effectiveUid),
      (snap) => {
        const arr = snap.data()?.hiddenSettings;
        setHiddenSettings(Array.isArray(arr) ? arr : []);
      },
      // Fail open — never hide settings because of a read error
      () => setHiddenSettings([]),
    );
    return unsub;
  }, [effectiveUid]);

  return {
    hiddenSettings,
    isHidden: (key) => hiddenSettings.includes(key),
    impersonating: !!adminCoachOverride,
  };
}
