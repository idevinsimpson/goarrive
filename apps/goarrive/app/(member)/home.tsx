/**
 * Member Home — Dashboard for members
 *
 * Shows the member's current status (pending/active),
 * their coach info, and plan status.
 * Enhanced with coach communication and actionable dashboard.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Pressable,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { FcmPermissionPrompt } from '../../lib/useFcmToken';
import { AppHeader } from '../../components/AppHeader';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useRouter } from 'expo-router';

interface MemberData {
  displayName?: string;
  status?: string;
  coachId?: string;
  intakeSubmissionId?: string;
  createdAt?: any;
  role?: string;
}

interface CoachData {
  displayName?: string;
  email?: string;
  phone?: string;
  bio?: string;
}

interface PlanData {
  id: string;
  status: string;
  hero?: {
    planTitle?: string;
    statusText?: string;
  };
}

export default function MemberHome() {
  const { user, claims } = useAuth();
  const router = useRouter();
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [coachData, setCoachData] = useState<CoachData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchMemberData();
  }, [user]);

  async function fetchMemberData() {
    try {
      // Get member document by UID
      const memberRef = doc(db, 'members', user!.uid);
      const memberSnap = await getDoc(memberRef);

      if (memberSnap.exists()) {
        const data = memberSnap.data() as MemberData;
        setMemberData(data);
        setFirstName(data.displayName?.split(' ')[0] || 'Member');

        // Fetch coach data if coachId is available
        if (data.coachId && data.coachId !== 'unassigned') {
          try {
            const coachRef = doc(db, 'coaches', data.coachId);
            const coachSnap = await getDoc(coachRef);
            if (coachSnap.exists()) {
              setCoachData(coachSnap.data() as CoachData);
            } else {
              // Try to get from members collection (for backward compatibility)
              const memberCoachRef = doc(db, 'members', data.coachId);
              const memberCoachSnap = await getDoc(memberCoachRef);
              if (memberCoachSnap.exists()) {
                const coachInfo = memberCoachSnap.data();
                setCoachData({
                  displayName: coachInfo.displayName,
                  email: coachInfo.email,
                });
              }
            }
          } catch (err) {
            console.error('[MemberHome] Error fetching coach data:', err);
          }
        }

        // Fetch the member's plan — collect all candidates, prefer presented/accepted
        const candidates: Array<{ id: string; [key: string]: any }> = [];

        const planByUid = await getDoc(doc(db, 'member_plans', user!.uid));
        if (planByUid.exists()) candidates.push({ id: planByUid.id, ...planByUid.data() });

        const planByLegacy = await getDoc(doc(db, 'member_plans', `plan_${user!.uid}`));
        if (planByLegacy.exists() && !candidates.find(c => c.id === planByLegacy.id))
          candidates.push({ id: planByLegacy.id, ...planByLegacy.data() });

        const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', user!.uid));
        const plansSnap = await getDocs(plansQuery);
        plansSnap.docs.forEach(d => {
          if (!candidates.find(c => c.id === d.id)) candidates.push({ id: d.id, ...d.data() });
        });

        if (candidates.length > 0) {
          const priority = ['accepted', 'presented', 'pending', 'draft'];
          const sorted = [...candidates].sort((a, b) => {
            const ai = priority.indexOf(a.status ?? 'draft');
            const bi = priority.indexOf(b.status ?? 'draft');
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });
          const best = sorted[0] as PlanData;
          setPlan(best);
          // Only hide plan if it's a draft (not yet shared with member)
          setIsPending(best.status === 'draft');
        } else {
          setIsPending(true);
        }
      }
    } catch (err) {
      console.error('[MemberHome] Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleEditInfo = () => {
    // Navigate to profile page
    // router.push('/(member)/profile');
  };

  const handleUploadPhoto = () => {
    // Navigate to profile page for photo upload
    // router.push('/(member)/profile');
  };

  const handleViewPlan = () => {
    router.push('/(member)/my-plan');
  };

  const handleContactCoach = () => {
    if (coachData?.email) {
      if (Platform.OS === 'web') {
        window.open(`mailto:${coachData.email}`, '_blank');
      }
    }
  };

  return (
    <View style={s.root}>
      <AppHeader title="Member Dashboard" />
      {/* In-app push notification permission prompt — only shown once per session
           when the user has not yet granted or denied notification permission */}
      <FcmPermissionPrompt uid={user?.uid} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
      >
        {/* Welcome Section with Member Badge */}
        <View style={s.welcomeSection}>
          <View style={s.welcomeLeft}>
            <Text style={s.greeting}>
              Welcome, {firstName}
            </Text>
            <View style={s.memberBadge}>
              <Text style={s.memberBadgeText}>MEMBER</Text>
            </View>
          </View>
          <View style={[s.statusBadge, isPending ? s.statusPending : s.statusActive]}>
            <Text style={[s.statusText, isPending ? s.statusTextPending : s.statusTextActive]}>
              {isPending ? 'Pending' : 'Active'}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : (
          <>
            {/* Plan Status Card */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>
                  {isPending ? 'Your Plan is Being Built' : 'Your Plan'}
                </Text>
              </View>
              <View style={s.cardBody}>
                {isPending ? (
                  <>
                    <Text style={s.cardText}>
                      Thank you for completing your intake form! Your coach is now
                      building a personalized plan tailored to your goals.
                    </Text>
                    <Text style={s.cardSubtext}>
                      You'll be notified when your plan is ready to review.
                    </Text>
                  </>
                ) : plan ? (
                  <>
                    <Text style={s.cardText}>
                      {plan.hero?.planTitle || 'Your Tailored Plan'}
                    </Text>
                    <Text style={s.cardSubtext}>
                      {plan.hero?.statusText || 'Your plan is ready'}
                    </Text>
                  </>
                ) : (
                  <Text style={s.cardText}>
                    No plan has been created yet. Please check back soon.
                  </Text>
                )}
              </View>
            </View>

            {/* Coach Info Card */}
            {coachData && (
              <View style={s.card}>
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle}>Your Coach</Text>
                </View>
                <View style={s.cardBody}>
                  <Text style={s.coachName}>{coachData.displayName || 'Your Coach'}</Text>
                  {coachData.email && (
                    <View style={s.coachInfoRow}>
                      <Text style={s.coachInfoLabel}>Email:</Text>
                      <Text style={s.coachInfoValue}>{coachData.email}</Text>
                    </View>
                  )}
                  {coachData.phone && (
                    <View style={s.coachInfoRow}>
                      <Text style={s.coachInfoLabel}>Phone:</Text>
                      <Text style={s.coachInfoValue}>{coachData.phone}</Text>
                    </View>
                  )}
                  {coachData.bio && (
                    <Text style={[s.cardText, { marginTop: 12 }]}>
                      {coachData.bio}
                    </Text>
                  )}
                  <Pressable
                    style={s.contactButton}
                    onPress={handleContactCoach}
                  >
                    <Text style={s.contactButtonText}>Contact Coach</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Quick Actions Card */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Quick Actions</Text>
              </View>
              <View style={s.cardBody}>
                <Pressable
                  style={s.actionButton}
                  onPress={handleUploadPhoto}
                >
                  <View style={s.actionButtonContent}>
                    <View style={s.actionIcon}>
                      <Text style={s.actionIconText}>📷</Text>
                    </View>
                    <View style={s.actionButtonText}>
                      <Text style={s.actionButtonTitle}>Upload Profile Photo</Text>
                      <Text style={s.actionButtonSubtitle}>Add a profile picture</Text>
                    </View>
                  </View>
                </Pressable>

                <Pressable
                  style={s.actionButton}
                  onPress={handleEditInfo}
                >
                  <View style={s.actionButtonContent}>
                    <View style={s.actionIcon}>
                      <Text style={s.actionIconText}>✏️</Text>
                    </View>
                    <View style={s.actionButtonText}>
                      <Text style={s.actionButtonTitle}>Edit My Information</Text>
                      <Text style={s.actionButtonSubtitle}>Update your details</Text>
                    </View>
                  </View>
                </Pressable>

                {!isPending && (
                  <Pressable
                    style={s.actionButton}
                    onPress={handleViewPlan}
                  >
                    <View style={s.actionButtonContent}>
                      <View style={s.actionIcon}>
                        <Text style={s.actionIconText}>📋</Text>
                      </View>
                      <View style={s.actionButtonText}>
                        <Text style={s.actionButtonTitle}>View Your Fitness Plan</Text>
                        <Text style={s.actionButtonSubtitle}>See your personalized plan</Text>
                      </View>
                    </View>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Tips Card */}
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>💡 Tips</Text>
              </View>
              <View style={s.cardBody}>
                <Text style={s.tipText}>
                  • Check back regularly for plan updates
                </Text>
                <Text style={s.tipText}>
                  • Keep your profile photo and information up to date
                </Text>
                <Text style={s.tipText}>
                  • Reach out to your coach with any questions
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'web' ? 100 : 24,
  },
  welcomeSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  welcomeLeft: {
    flex: 1,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 8,
  },
  memberBadge: {
    backgroundColor: 'rgba(245, 166, 35, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  memberBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5A623',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusPending: {
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
  },
  statusActive: {
    backgroundColor: 'rgba(72, 187, 120, 0.15)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusTextPending: {
    color: '#F5A623',
  },
  statusTextActive: {
    color: '#48BB78',
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#151B26',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  cardText: {
    fontSize: 14,
    color: '#A0AEC0',
    lineHeight: 22,
    marginBottom: 8,
  },
  cardSubtext: {
    fontSize: 13,
    color: '#718096',
    lineHeight: 20,
  },
  coachName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    marginBottom: 12,
  },
  coachInfoRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  coachInfoLabel: {
    fontSize: 13,
    color: '#718096',
    fontWeight: '600',
    marginRight: 8,
    minWidth: 50,
  },
  coachInfoValue: {
    fontSize: 13,
    color: '#A0AEC0',
    flex: 1,
  },
  contactButton: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  contactButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 14,
  },
  actionButton: {
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2D3A4A',
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    marginRight: 12,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderRadius: 8,
  },
  actionIconText: {
    fontSize: 20,
  },
  actionButtonText: {
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    marginBottom: 2,
  },
  actionButtonSubtitle: {
    fontSize: 12,
    color: '#718096',
  },
  tipText: {
    fontSize: 13,
    color: '#A0AEC0',
    lineHeight: 20,
    marginBottom: 6,
  },
});
