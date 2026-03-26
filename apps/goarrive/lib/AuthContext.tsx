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
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { registerForPushNotifications } from './notifications';

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
  /** Admin-only: override coachId to view another coach's data */
  adminCoachOverride: string | null;
  setAdminCoachOverride: (coachId: string | null) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({
  user: null,
  claims: null,
  loading: true,
  signOut: async () => {},
  adminCoachOverride: null,
  setAdminCoachOverride: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<CustomClaims | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminCoachOverride, _setAdminCoachOverride] = useState<string | null>(null);

  // Wrap setAdminCoachOverride to log audit events
  const setAdminCoachOverride = React.useCallback((coachId: string | null) => {
    _setAdminCoachOverride(coachId);
    // Fire-and-forget audit log
    if (user) {
      const eventType = coachId ? 'admin_impersonate_start' : 'admin_impersonate_end';
      addDoc(collection(db, 'eventLog'), {
        type: eventType,
        adminUid: user.uid,
        adminEmail: user.email ?? '',
        targetCoachId: coachId ?? 'exited',
        timestamp: serverTimestamp(),
      }).catch(err => console.warn('[AuthContext] Audit log failed:', err));
    }
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          // Force refresh ID token to get latest custom claims
          const tokenResult = await firebaseUser.getIdTokenResult(true);
          let userClaims = (tokenResult.claims as CustomClaims) ?? {};
          console.log('[AuthContext] Custom claims from token:', userClaims);

          // If role is 'coach' but coachId is missing, set it to the user's UID.
          // This handles the case where custom claims include role but not coachId.
          if (userClaims.role === 'coach' && !userClaims.coachId) {
            userClaims.coachId = firebaseUser.uid;
          }

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
                  // Default to 'member' if no profile found.
                  // This handles the intake form race condition: createUserWithEmailAndPassword
                  // fires onAuthStateChanged before the members doc is written, so neither
                  // collection has a doc yet. New users from intake are always members, not coaches.
                  // Coaches are always created through the admin flow and will have a coaches doc.
                  console.log('[AuthContext] No coach doc found, defaulting to member role');
                  userClaims.role = 'member';
                }
              }
            } catch (err) {
              console.error('[AuthContext] Error reading Firestore profile:', err);
              // Default to 'member' on error — same reasoning as above.
              // A Firestore permissions error here most likely means the members doc
              // was not yet written (intake race condition). Defaulting to member is safe
              // because the (member) layout will re-check claims on every render.
              userClaims.role = 'member';
            }
          }

          console.log('[AuthContext] Final claims:', userClaims);

          setClaims(userClaims);

          // Register for push notifications (fire-and-forget)
          registerForPushNotifications(firebaseUser.uid).catch((e) =>
            console.warn('[AuthContext] Push registration failed:', e),
          );
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

  // When admin override is active, produce modified claims with the overridden coachId
  const effectiveClaims = React.useMemo(() => {
    if (!claims || !adminCoachOverride) return claims;
    if (claims.role !== 'platformAdmin' && claims.admin !== true) return claims;
    return { ...claims, coachId: adminCoachOverride };
  }, [claims, adminCoachOverride]);

  return (
    <AuthContext.Provider
      value={{ user, claims: effectiveClaims, loading, signOut: handleSignOut, adminCoachOverride, setAdminCoachOverride }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
