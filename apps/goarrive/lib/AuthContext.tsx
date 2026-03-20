/**
 * AuthContext — Firebase Auth state provider for GoArrive
 *
 * Provides the current user, custom claims (role, coachId, tenantId),
 * and loading state to the entire app via React context.
 *
 * Role is read from the user's Firestore profile:
 *   - role: 'platformAdmin' | 'coach' | 'coachAssistant' | 'member'
 *   - coachId: string (the coach's UID)
 *   - tenantId: string (same as coachId for coaches; coachId for members)
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
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

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
          // Force refresh ID token to get latest custom claims
          const tokenResult = await firebaseUser.getIdTokenResult(true);
          let userClaims = (tokenResult.claims as CustomClaims) ?? {};
          console.log('[AuthContext] Custom claims from token:', userClaims);

          // If no role in custom claims, try to read from Firestore
          if (!userClaims.role) {
            try {
              // Try to read from members collection first (for members)
              const memberDoc = await getDoc(
                doc(db, 'members', firebaseUser.uid)
              );
              if (memberDoc.exists()) {
                const memberData = memberDoc.data();
                console.log('[AuthContext] Member data from Firestore:', memberData);
                userClaims.role = memberData.role || 'member';
                userClaims.coachId = memberData.coachId;
                console.log('[AuthContext] Set role to:', userClaims.role);
              } else {
                console.log('[AuthContext] No member doc found, checking coaches collection...');
                // Try to read from coaches collection (for coaches)
                const coachDoc = await getDoc(
                  doc(db, 'coaches', firebaseUser.uid)
                );
                if (coachDoc.exists()) {
                  const coachData = coachDoc.data();
                  console.log('[AuthContext] Coach data from Firestore:', coachData);
                  userClaims.role = coachData.role || 'coach';
                  userClaims.coachId = firebaseUser.uid;
                } else {
                  // Default to 'coach' if no profile found (for backward compatibility)
                  console.log('[AuthContext] No coach doc found, defaulting to coach role');
                  userClaims.role = 'coach';
                  userClaims.coachId = firebaseUser.uid;
                }
              }
            } catch (err) {
              console.error('[AuthContext] Error reading Firestore profile:', err);
              // Default to 'coach' on error
              userClaims.role = 'coach';
              userClaims.coachId = firebaseUser.uid;
            }
          }

          // FORCE OVERRIDE for Jane Smith (testing purposes)
          if (firebaseUser.email === 'jane.smith.2026@example.com') {
            console.log('[AuthContext] Overriding role to member for Jane Smith');
            userClaims.role = 'member';
          }

          console.log('[AuthContext] Final claims:', userClaims);
          setClaims(userClaims);
        } catch (err) {
          console.error('[AuthContext] Auth error:', err);
          setClaims(null);
        }
      } else {
        console.log('[AuthContext] User signed out');
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
