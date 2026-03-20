/**
 * Member Home — Dashboard for members
 *
 * Shows the member's current status (pending/active),
 * their coach info, and plan status.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
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

interface MemberData {
  displayName?: string;
  status?: string;
  coachId?: string;
  intakeSubmissionId?: string;
  createdAt?: any;
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
  const [memberData, setMemberData] = useState<MemberData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchMemberData();
  }, [user]);

  async function fetchMemberData() {
    try {
      // Try to get member document by UID
      const memberRef = doc(db, 'members', user!.uid);
      const memberSnap = await getDoc(memberRef);

      if (memberSnap.exists()) {
        const data = memberSnap.data() as MemberData;
        setMemberData(data);

        // Fetch the member's plan
        const plansQuery = query(
          collection(db, 'member_plans'),
          where('memberId', '==', user!.uid)
        );
        const plansSnap = await getDocs(plansQuery);
        if (!plansSnap.empty) {
          const planDoc = plansSnap.docs[0];
          setPlan({ id: planDoc.id, ...planDoc.data() } as PlanData);
        }
      }
    } catch (err) {
      console.error('[MemberHome] Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  const firstName = user?.displayName?.split(' ')[0] || 'there';
  const status = memberData?.status || 'pending';
  const isPending = status === 'pending';

  return (
    <View style={styles.root}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <Text style={styles.greeting}>
            Welcome, {firstName}
          </Text>
          <View style={[styles.statusBadge, isPending ? styles.statusPending : styles.statusActive]}>
            <Text style={[styles.statusText, isPending ? styles.statusTextPending : styles.statusTextActive]}>
              {isPending ? 'Plan Build: Pending' : 'Active'}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : (
          <>
            {/* Status Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {isPending ? 'Your Plan is Being Built' : 'Your Plan'}
                </Text>
              </View>
              <View style={styles.cardBody}>
                {isPending ? (
                  <>
                    <Text style={styles.cardText}>
                      Thank you for completing your intake form! Your coach is now
                      building a personalized plan tailored to your goals.
                    </Text>
                    <Text style={styles.cardSubtext}>
                      You'll be notified when your plan is ready to review.
                    </Text>
                  </>
                ) : plan ? (
                  <>
                    <Text style={styles.cardText}>
                      {plan.hero?.planTitle || 'Your Tailored Plan'}
                    </Text>
                    <Text style={styles.cardSubtext}>
                      {plan.hero?.statusText || 'Your plan is ready'}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.cardText}>
                    No plan has been created yet. Please check back soon.
                  </Text>
                )}
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Quick Actions</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.actionRow}>
                  <View style={styles.actionDot} />
                  <Text style={styles.actionText}>Update your profile photo</Text>
                </View>
                <View style={styles.actionRow}>
                  <View style={styles.actionDot} />
                  <Text style={styles.actionText}>Review your submitted information</Text>
                </View>
                {!isPending && (
                  <View style={styles.actionRow}>
                    <View style={styles.actionDot} />
                    <Text style={styles.actionText}>View your training plan</Text>
                  </View>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F5A623',
    marginRight: 12,
  },
  actionText: {
    fontSize: 14,
    color: '#A0AEC0',
  },
});
