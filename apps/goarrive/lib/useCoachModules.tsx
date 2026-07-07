/**
 * useCoachModules — per-coach module visibility (admin-controlled feature gating)
 *
 * Reads enabledModules from coaches/{effectiveUid} via a live onSnapshot so
 * admin toggles take effect immediately (no custom-claims token lag).
 * Missing field or missing key = enabled (back-compat: existing coaches keep
 * the full app). Dashboard is never gated.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Redirect } from 'expo-router';
import { db } from './firebase';
import { useAuth } from './AuthContext';

export const MODULE_KEYS = [
  'members',
  'build',
  'scheduling',
  'billing',
  'account',
  'coachLaunch',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  members: 'Members',
  build: 'Build',
  scheduling: 'Scheduling',
  billing: 'Billing',
  account: 'Account',
  coachLaunch: 'Coach Launch',
};

export function resolveModules(
  enabledModules: Record<string, boolean> | null | undefined,
): Record<ModuleKey, boolean> {
  const out = {} as Record<ModuleKey, boolean>;
  for (const key of MODULE_KEYS) {
    out[key] = enabledModules?.[key] !== false;
  }
  return out;
}

export function useCoachModules(): {
  modules: Record<ModuleKey, boolean>;
  loading: boolean;
} {
  const { claims, effectiveUid, adminCoachOverride } = useAuth();
  // platformAdmin viewing their own app is never gated. During impersonation,
  // claims are masked to role 'coach' so gating previews the coach's view.
  const isAdminSelf =
    !adminCoachOverride &&
    (claims?.role === 'platformAdmin' || claims?.admin === true);
  // undefined = still loading; null = no gating data (all enabled)
  const [raw, setRaw] = useState<Record<string, boolean> | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!effectiveUid || isAdminSelf) {
      setRaw(null);
      return;
    }
    setRaw(undefined);
    const unsub = onSnapshot(
      doc(db, 'coaches', effectiveUid),
      (snap) => {
        setRaw(
          (snap.data()?.enabledModules as Record<string, boolean>) ?? null,
        );
      },
      (err) => {
        // Fail open — never lock a coach out because of a read error
        console.warn('[useCoachModules] snapshot error:', err);
        setRaw(null);
      },
    );
    return unsub;
  }, [effectiveUid, isAdminSelf]);

  const loading = raw === undefined;
  const modules = useMemo(() => resolveModules(raw ?? null), [raw]);
  return { modules, loading };
}

/**
 * ModuleGate — route guard for gated screens. Redirects to the dashboard when
 * the module is disabled (covers deeplinks and hidden-route navigation).
 * Renders children while loading (fail open, no flash-redirect).
 */
export function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey;
  children: React.ReactNode;
}) {
  const { modules, loading } = useCoachModules();
  if (!loading && !modules[module]) {
    return <Redirect href="/(app)/dashboard" />;
  }
  return <>{children}</>;
}
