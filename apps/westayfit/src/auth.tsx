import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';

import { wsfAuthEnabled } from './featureFlags';
import { getFirebaseAuth } from './firebase';
import { kit } from './ui/kit';

export type WsfAuthState = {
  ready: boolean;
  user: User | null;
  /**
   * INT-27 (native only): the first auth answer has not come within
   * AUTH_SLOW_MS. Still not ready, and never signed out because of it; a
   * screen waiting on `ready` can say it is still connecting.
   */
  slow: boolean;
};

/** How long a phone waits for the first auth answer before saying it is still connecting. */
export const AUTH_SLOW_MS = 4_000;

const AuthContext = createContext<WsfAuthState>({ ready: false, user: null, slow: false });

/*
  INT-27. A STALLED FIRST AUTH ANSWER IS NOT A SIGN-OUT.

  On a phone the first onAuthStateChanged waits for Firebase to restore the
  persisted user, which reloads it from the network. Offline, that reload can
  take a long time, and Home sat on "Loading…" saying nothing. Firebase does
  not sign the member out when the reload fails for want of a network:
  reloadAndSetCurrentUserOrClear keeps the user on auth/network-request-failed
  (@firebase/auth 1.10.8, dist/rn/index-b5f6ef87.js:2730-2743; the same in
  dist/esm2017/index-35c79a8a.js:2827-2840). So after AUTH_SLOW_MS without an
  answer the state says `slow` (still not ready, user untouched) until the
  first answer arrives, which clears it. Native only: the web keeps its
  behaviour.
*/
export function WsfAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WsfAuthState>({ ready: false, user: null, slow: false });

  useEffect(() => {
    if (!wsfAuthEnabled) {
      setState({ ready: true, user: null, slow: false });
      return;
    }
    let answered = false;
    const slowTimer =
      Platform.OS !== 'web'
        ? setTimeout(() => {
            if (!answered) setState((s) => (s.ready ? s : { ...s, slow: true }));
          }, AUTH_SLOW_MS)
        : null;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      answered = true;
      if (slowTimer !== null) clearTimeout(slowTimer);
      setState({ ready: true, user, slow: false });
    });
    return () => {
      if (slowTimer !== null) clearTimeout(slowTimer);
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useWsfAuth(): WsfAuthState {
  return useContext(AuthContext);
}

/**
 * INT-27: what a screen waiting on auth says once it is slow. Home uses it;
 * published for the other screens that wait on `ready`.
 */
export function AuthConnectingNote({ testID }: { testID?: string }) {
  return (
    <View testID={testID}>
      <Text style={kit.statusText}>Connecting…</Text>
      <Text style={kit.body}>We’re still reaching We Stay Fit. Check your connection.</Text>
    </View>
  );
}
