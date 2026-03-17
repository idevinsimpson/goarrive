/**
 * Workouts screen — GoArrive Workout Library
 *
 * Full CRUD for coach's workout library.
 * Uses the GoArrive design system: dark bg, gold accents, Space Grotesk + DM Sans.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  TextInput,
} from 'react-native';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  orderBy,
} from 'firebase/firestore';
import { AppHeader } from '../../components/AppHeader';
import ListSkeleton from '../../components/ListSkeleton';
import WorkoutForm from '../../components/WorkoutForm';
import WorkoutDetail from '../../components/WorkoutDetail';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Ionicons } from '@expo/vector-icons';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function WorkoutsScreen() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';

  const [workouts, setWorkouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<any>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const loadWorkouts = useCallback(async () => {
    try {
      const q = query(
        collection(db, 'workouts'),
        where('coachId', '==', coachId),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      setWorkouts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Failed to load workouts:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coachId]);

  useEffect(() => {
    if (coachId) loadWorkouts();
  }, [coachId, loadWorkouts]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadWorkouts();
  }, [loadWorkouts]);

  function requestDelete(w: any) {
    setDeleteTarget({ id: w.id, name: w.name });
    setConfirmVisible(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'workouts', deleteTarget.id));
      await loadWorkouts();
    } catch (err) {
      console.error('Failed to delete workout:', err);
    }
  }

  const filtered = workouts.filter((w) =>
    w.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Page header */}
      <View style={s.header}>
        <Text style={s.title}>Workouts</Text>
        <Pressable style={s.addBtn} onPress={() => setShowForm(true)}>
          <Ionicons name="add" size={20} color="#0E1117" />
          <Text style={s.addBtnText}>New</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={16} color="#4A5568" />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search workouts…"
            placeholderTextColor="#4A5568"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color="#4A5568" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Count */}
      <Text style={s.countText}>
        {filtered.length} workout{filtered.length !== 1 ? 's' : ''}
      </Text>

      {/* List */}
      {loading ? (
        <ListSkeleton count={5} />
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#F5A623"
              colors={['#F5A623']}
            />
          }
        >
          {filtered.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="barbell-outline" size={40} color="#2A3347" />
              <Text style={s.emptyTitle}>
                {search ? 'No workouts match your search' : 'No workouts yet'}
              </Text>
              <Text style={s.emptyBody}>
                {search
                  ? 'Try a different search term.'
                  : 'Tap "New" to create your first workout.'}
              </Text>
            </View>
          ) : (
            filtered.map((item) => (
              <Pressable
                key={item.id}
                style={s.card}
                onPress={() => setSelectedWorkout(item)}
              >
                <View style={s.cardLeft}>
                  <View style={s.cardIcon}>
                    <Ionicons name="barbell" size={18} color="#7DD3FC" />
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={s.cardSub} numberOfLines={1}>
                      {item.blocks?.length || 0} block
                      {(item.blocks?.length || 0) !== 1 ? 's' : ''}
                      {item.description ? ` · ${item.description}` : ''}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={s.deleteBtn}
                  onPress={() => requestDelete(item)}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color="#4A5568" />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}

      {showForm && (
        <WorkoutForm
          visible={showForm}
          onClose={() => {
            setShowForm(false);
            loadWorkouts();
          }}
        />
      )}

      {selectedWorkout && (
        <WorkoutDetail
          workout={selectedWorkout}
          onClose={() => {
            setSelectedWorkout(null);
            loadWorkouts();
          }}
        />
      )}

      <ConfirmDialog
        visible={confirmVisible}
        title="Delete Workout"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          setConfirmVisible(false);
          await confirmDelete();
        }}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5A623',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  searchRow: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  countText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  scroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(125,211,252,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  cardSub: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  deleteBtn: {
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FONT_HEADING,
    marginTop: 8,
  },
  emptyBody: {
    fontSize: 13,
    color: '#2A3347',
    fontFamily: FONT_BODY,
    textAlign: 'center',
  },
});
