/**
 * Movements screen — GoArrive Movement Library
 *
 * Full CRUD for coach's movement library.
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
import MovementForm from '../../components/MovementForm';
import MovementDetail from '../../components/MovementDetail';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Ionicons } from '@expo/vector-icons';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CATEGORY_COLORS: Record<string, string> = {
  Strength: '#F5A623',
  Cardio: '#7DD3FC',
  Mobility: '#86EFAC',
  Core: '#C084FC',
  Olympic: '#FB923C',
  Plyometric: '#F472B6',
};

function categoryColor(cat?: string): string {
  return CATEGORY_COLORS[cat ?? ''] ?? '#4A5568';
}

export default function MovementsScreen() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';

  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<any>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const loadMovements = useCallback(async () => {
    try {
      const q = query(
        collection(db, 'movements'),
        where('coachId', '==', coachId),
        orderBy('name', 'asc'),
      );
      const snap = await getDocs(q);
      setMovements(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Failed to load movements:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coachId]);

  useEffect(() => {
    if (coachId) loadMovements();
  }, [coachId, loadMovements]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadMovements();
  }, [loadMovements]);

  function requestDelete(m: any) {
    setDeleteTarget({ id: m.id, name: m.name });
    setConfirmVisible(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'movements', deleteTarget.id));
      await loadMovements();
    } catch (err) {
      console.error('Failed to delete movement:', err);
    }
  }

  const filtered = movements.filter(
    (m) =>
      m.name?.toLowerCase().includes(search.toLowerCase()) ||
      m.category?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Page header */}
      <View style={s.header}>
        <Text style={s.title}>Movements</Text>
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
            placeholder="Search movements or categories…"
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
        {filtered.length} movement{filtered.length !== 1 ? 's' : ''}
      </Text>

      {/* List */}
      {loading ? (
        <ListSkeleton count={8} />
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
              <Ionicons name="fitness-outline" size={40} color="#2A3347" />
              <Text style={s.emptyTitle}>
                {search ? 'No movements match your search' : 'No movements yet'}
              </Text>
              <Text style={s.emptyBody}>
                {search
                  ? 'Try a different search term.'
                  : 'Tap "New" to add your first movement.'}
              </Text>
            </View>
          ) : (
            filtered.map((item) => (
              <Pressable
                key={item.id}
                style={s.card}
                onPress={() => setSelectedMovement(item)}
              >
                <View style={s.cardLeft}>
                  <View
                    style={[
                      s.cardIcon,
                      {
                        backgroundColor: `${categoryColor(item.category)}18`,
                      },
                    ]}
                  >
                    <Ionicons
                      name="fitness"
                      size={18}
                      color={categoryColor(item.category)}
                    />
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={s.cardSub} numberOfLines={1}>
                      {item.category || 'Uncategorized'}
                      {item.equipment ? ` · ${item.equipment}` : ''}
                    </Text>
                  </View>
                </View>
                {item.category && (
                  <View
                    style={[
                      s.catBadge,
                      { borderColor: `${categoryColor(item.category)}40` },
                    ]}
                  >
                    <Text
                      style={[
                        s.catBadgeText,
                        { color: categoryColor(item.category) },
                      ]}
                    >
                      {item.category}
                    </Text>
                  </View>
                )}
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
        <MovementForm
          visible={showForm}
          onClose={() => {
            setShowForm(false);
            loadMovements();
          }}
        />
      )}

      {selectedMovement && (
        <MovementDetail
          visible={!!selectedMovement}
          movement={selectedMovement}
          onClose={() => {
            setSelectedMovement(null);
            loadMovements();
          }}
          onEdit={() => {}}
          onArchive={() => {}}
        />
      )}

      <ConfirmDialog
        visible={confirmVisible}
        title="Delete Movement"
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
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    gap: 10,
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
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: '600',
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
