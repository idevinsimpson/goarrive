/**
 * AuthContext — Firebase Auth state provider for GoArrive
 *
 * Provides the current user, custom claims (role, coachId, tenantId),
 * and loading state to the entire app via React context.
 *
 * Custom claims expected on the Firebase ID token:
 *   - role: 'platformAdmin' | 'coach' | 'coachAssistant' | 'member'
 *   - coachId: string (the coach's UID)
 *   - tenantId: string (same as coachId for coaches; coachId for members)
 *   - admin: boolean (legacy flag)
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  User,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from './firebase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CustomClaims {
  role?: string;
  coachId?: string;
  tenantId?: string;
  admin?: boolean;
  [key: string]: any;
}

interface AuthContextValue {
  user: User | null;
  claims: CustomClaims | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  claims: null,
  loading: true,
  signOut: async () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<CustomClaims | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          setClaims((tokenResult.claims as CustomClaims) ?? null);
        } catch {
          setClaims(null);
        }
      } else {
        setUser(null);
        setClaims(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  async function handleSignOut() {
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error('[AuthContext] Sign out error:', err);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, claims, loading, signOut: handleSignOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
