import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { AppHeader } from '../../components/AppHeader';
import CheckInCard from '../../components/CheckInCard';
import ListSkeleton from '../../components/ListSkeleton';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function DashboardScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    members: 0,
    activeWorkouts: 0,
    recentCheckins: [] as any[],
  });

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch stats
      const membersSnap = await getDocs(collection(db, 'members'));
      const workoutsSnap = await getDocs(collection(db, 'workouts'));
      
      // Fetch recent check-ins
      const checkinsQuery = query(
        collection(db, 'checkins'),
        orderBy('timestamp', 'desc'),
        limit(5)
      );
      const checkinsSnap = await getDocs(checkinsQuery);
      const recentCheckins = checkinsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setStats({
        members: membersSnap.size,
        activeWorkouts: workoutsSnap.size,
        recentCheckins,
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  return (
    <View style={styles.container}>
      <AppHeader />
      <ScrollView 
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFB347" />
        }
      >
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>Welcome back, Coach!</Text>
          <Text style={styles.dateText}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>

        <View style={styles.statsGrid}>
          <TouchableOpacity style={styles.statCard} onPress={() => router.push('/members')}>
            <Ionicons name="people" size={24} color="#FFB347" />
            <Text style={styles.statNumber}>{stats.members}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} onPress={() => router.push('/workouts')}>
            <Ionicons name="barbell" size={24} color="#FFB347" />
            <Text style={styles.statNumber}>{stats.activeWorkouts}</Text>
            <Text style={styles.statLabel}>Workouts</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
        </View>

        {loading ? (
          <ListSkeleton count={3} />
        ) : stats.recentCheckins.length > 0 ? (
          stats.recentCheckins.map((checkin) => (
            <CheckInCard key={checkin.id} />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="time-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>No recent activity yet.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  welcomeSection: {
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  dateText: {
    fontSize: 16,
    color: '#888',
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#1C2128',
    borderRadius: 12,
    padding: 16,
    width: '48%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginVertical: 8,
  },
  statLabel: {
    fontSize: 14,
    color: '#888',
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: '#1C2128',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  emptyText: {
    color: '#888',
    marginTop: 12,
    fontSize: 16,
  },
});
