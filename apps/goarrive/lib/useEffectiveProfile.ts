/**
 * useEffectiveProfile — identity (name / initials / photo / email) for the
 * effective user. When a platform admin is impersonating a coach ("View as
 * Coach"), resolves the COACH's profile from coaches/{effectiveUid} (falling
 * back to users/{effectiveUid}) so headers, panels, and the account screen
 * show the coach's identity instead of the admin's.
 */
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';

export interface EffectiveProfile {
  displayName: string;
  initials: string;
  photoURL: string | null;
  email: string | null;
  /** True when a platform admin is viewing as a coach */
  impersonating: boolean;
}

function toInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface CoachProfile {
  name: string;
  photoURL: string | null;
  email: string | null;
}

export function useEffectiveProfile(): EffectiveProfile {
  const { user, adminCoachOverride, effectiveUid } = useAuth();
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null);

  useEffect(() => {
    if (!adminCoachOverride || !effectiveUid) {
      setCoachProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [coachSnap, userSnap] = await Promise.all([
          getDoc(doc(db, 'coaches', effectiveUid)),
          getDoc(doc(db, 'users', effectiveUid)).catch(() => null),
        ]);
        const c = (coachSnap.exists() ? coachSnap.data() : {}) as Record<string, any>;
        const u = (userSnap?.exists() ? userSnap.data() : {}) as Record<string, any>;
        if (cancelled) return;
        setCoachProfile({
          name:
            c.displayName || c.name || u.displayName || adminCoachOverride.coachName,
          photoURL: c.photoURL || c.photoUrl || c.avatarUrl || u.photoURL || null,
          email: c.email || u.email || null,
        });
      } catch (err) {
        console.warn('[useEffectiveProfile] coach profile fetch failed:', err);
        if (!cancelled) {
          setCoachProfile({
            name: adminCoachOverride.coachName,
            photoURL: null,
            email: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminCoachOverride, effectiveUid]);

  if (adminCoachOverride) {
    const name = coachProfile?.name || adminCoachOverride.coachName;
    return {
      displayName: name,
      initials: toInitials(name),
      photoURL: coachProfile?.photoURL ?? null,
      email: coachProfile?.email ?? null,
      impersonating: true,
    };
  }

  const name = user?.displayName || user?.email?.split('@')[0] || 'User';
  return {
    displayName: name,
    initials: user?.displayName
      ? toInitials(user.displayName)
      : user?.email?.[0]?.toUpperCase() ?? '?',
    photoURL: user?.photoURL ?? null,
    email: user?.email ?? null,
    impersonating: false,
  };
}
