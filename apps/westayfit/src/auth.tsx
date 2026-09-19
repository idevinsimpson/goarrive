import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { wsfAuthEnabled } from './featureFlags';
import { getFirebaseAuth } from './firebase';

export type WsfAuthState = {
  ready: boolean;
  user: User | null;
};

const AuthContext = createContext<WsfAuthState>({ ready: false, user: null });

export function WsfAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WsfAuthState>({ ready: false, user: null });

  useEffect(() => {
    if (!wsfAuthEnabled) {
      setState({ ready: true, user: null });
      return;
    }
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      setState({ ready: true, user });
    });
    return unsubscribe;
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useWsfAuth(): WsfAuthState {
  return useContext(AuthContext);
}
