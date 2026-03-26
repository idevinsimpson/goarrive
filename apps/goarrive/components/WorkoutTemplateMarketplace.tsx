/**
 * WorkoutTemplateMarketplace — Browse & clone shared workout templates
 *
 * Displays workout templates that have been marked as `isShared: true`
 * by platform admins. Coaches can preview a template and clone it into
 * their own workout library with one tap.
 *
 * This is the first step toward a full marketplace — currently admin-curated,
 * no ratings or pricing. Follows the "template + tweak" philosophy from the
 * GoArrive Workout Builder Rules.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CATEGORIES = [
  'All',
  'Upper Body',
  'Lower Body',
  'Full Body',
  'Core',
  'Cardio',
  'Mobility',
  'Recovery',
];

interface SharedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  estimatedDurationMin: number | null;
  tags: string[];
  blocks: any[];
  coachId: string;
  coachName?: string;
}

interface Props {
  visible: boolean;
  coachId: string;
  tenantId: string;
  onClose: () => void;
  /** Called after a template is cloned so the parent can refresh */
  onCloned?: () => void;
}

export default function WorkoutTemplateMarketplace({
  visible,
  coachId,
  tenantId,
  onClose,
  onCloned,
}: Props) {
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<SharedTemplate | null>(null);

  useEffect(() => {
    if (!visible) return;
    loadTemplates();
  }, [visible]);

  async function loadTemplates() {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'workouts'),
        where('isTemplate', '==', true),
        where('isShared', '==', true),
      );
      const snap = await getDocs(q);
      const list: SharedTemplate[] = snap.docs
        .filter((d) => d.data().coachId !== coachId) // exclude own templates
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name ?? '',
            description: data.description ?? '',
            category: data.category ?? '',
            difficulty: data.difficulty ?? '',
            estimatedDurationMin: data.estimatedDurationMin ?? null,
            tags: data.tags ?? [],
            blocks: data.blocks ?? [],
            coachId: data.coachId ?? '',
            coachName: data.coachName ?? '',
          };
        });
      setTemplates(list);
    } catch (err) {
      console.error('[TemplateMarketplace] Load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = templates.filter((t) => {
    if (searchText && !t.name.toLowerCase().includes(searchText.toLowerCase())) {
      return false;
    }
    if (
      selectedCategory !== 'All' &&
      t.category.toLowerCase() !== selectedCategory.toLowerCase()
    ) {
      return false;
    }
    return true;
  });

  const handleClone = useCallback(
    async (template: SharedTemplate) => {
      setCloningId(template.id);
      try {
        await addDoc(collection(db, 'workouts'), {
          name: `${template.name} (Cloned)`,
          description: template.description,
          category: template.category,
          difficulty: template.difficulty,
          estimatedDurationMin: template.estimatedDurationMin,
          tags: [...template.tags],
          blocks: [...template.blocks],
          coachId,
          tenantId,
          isTemplate: false,
          isShared: false,
          isArchived: false,
          clonedFrom: template.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        Alert.alert(
          'Template Cloned',
          `"${template.name}" has been added to your workout library. You can now customize it.`,
        );
        onCloned?.();
        setPreviewTemplate(null);
      } catch (err) {
        console.error('[TemplateMarketplace] Clone error:', err);
        Alert.alert('Error', 'Could not clone template. Please try again.');
      } finally {
        setCloningId(null);
      }
    },
    [coachId, tenantId, onCloned],
  );

  const renderItem = ({ item: t }: { item: SharedTemplate }) => (
    <Pressable style={s.card} onPress={() => setPreviewTemplate(t)}>
      <View style={s.cardTop}>
        <Text style={s.cardName} numberOfLines={1}>
          {t.name}
        </Text>
        <Icon name="chevron-right" size={18} color="#4A5568" />
      </View>
      {t.description ? (
        <Text style={s.cardDesc} numberOfLines={2}>
          {t.description}
        </Text>
      ) : null}
      <View style={s.cardBadgeRow}>
        {t.category ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{t.category}</Text>
          </View>
        ) : null}
        {t.difficulty ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{t.difficulty}</Text>
          </View>
        ) : null}
        {t.estimatedDurationMin ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{t.estimatedDurationMin} min</Text>
          </View>
        ) : null}
        <View style={s.cardBadge}>
          <Text style={s.cardBadgeText}>
            {t.blocks.length} block{t.blocks.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Icon name="grid" size={20} color="#F5A623" />
              <Text style={s.headerTitle}>Template Marketplace</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={24} color="#8A95A3" />
            </Pressable>
          </View>

          {/* Search */}
          <View style={s.searchRow}>
            <View style={s.searchWrap}>
              <Icon name="search" size={16} color="#4A5568" />
              <TextInput
                style={s.searchInput}
                placeholder="Search templates..."
                placeholderTextColor="#4A5568"
                value={searchText}
                onChangeText={setSearchText}
              />
            </View>
          </View>

          {/* Category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipScroll}
          >
            {CATEGORIES.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <Pressable
                  key={cat}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Count */}
          <Text style={s.countText}>
            {filtered.length} template{filtered.length !== 1 ? 's' : ''} available
          </Text>

          {/* List */}
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color="#F5A623" />
            </View>
          ) : filtered.length === 0 ? (
            <View style={s.emptyWrap}>
              <Icon name="grid" size={48} color="#2A3040" />
              <Text style={s.emptyText}>
                {templates.length === 0
                  ? 'No shared templates available yet'
                  : 'No templates match your search'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      {/* Preview modal */}
      {previewTemplate && (
        <Modal
          visible={!!previewTemplate}
          animationType="slide"
          transparent
          onRequestClose={() => setPreviewTemplate(null)}
        >
          <View style={s.overlay}>
            <View style={[s.sheet, { maxHeight: '80%' }]}>
              <View style={s.handle} />
              <View style={s.header}>
                <Text style={s.headerTitle} numberOfLines={1}>
                  {previewTemplate.name}
                </Text>
                <Pressable onPress={() => setPreviewTemplate(null)} hitSlop={12}>
                  <Icon name="close" size={24} color="#8A95A3" />
                </Pressable>
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 20, gap: 12 }}
                showsVerticalScrollIndicator={false}
              >
                {previewTemplate.description ? (
                  <Text style={s.previewDesc}>{previewTemplate.description}</Text>
                ) : null}

                <View style={s.cardBadgeRow}>
                  {previewTemplate.category ? (
                    <View style={s.cardBadge}>
                      <Text style={s.cardBadgeText}>{previewTemplate.category}</Text>
                    </View>
                  ) : null}
                  {previewTemplate.difficulty ? (
                    <View style={s.cardBadge}>
                      <Text style={s.cardBadgeText}>{previewTemplate.difficulty}</Text>
                    </View>
                  ) : null}
                  {previewTemplate.estimatedDurationMin ? (
                    <View style={s.cardBadge}>
                      <Text style={s.cardBadgeText}>
                        {previewTemplate.estimatedDurationMin} min
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Block summary */}
                <Text style={s.sectionTitle}>
                  {previewTemplate.blocks.length} Block
                  {previewTemplate.blocks.length !== 1 ? 's' : ''}
                </Text>
                {previewTemplate.blocks.map((block: any, i: number) => (
                  <View key={i} style={s.blockCard}>
                    <Text style={s.blockName}>
                      {block.name || `Block ${i + 1}`}
                    </Text>
                    <Text style={s.blockMeta}>
                      {block.movements?.length ?? 0} movement
                      {(block.movements?.length ?? 0) !== 1 ? 's' : ''}
                      {block.rounds ? ` · ${block.rounds} round${block.rounds !== 1 ? 's' : ''}` : ''}
                    </Text>
                  </View>
                ))}

                {previewTemplate.tags.length > 0 && (
                  <Text style={s.tagsText}>
                    Tags: {previewTemplate.tags.join(', ')}
                  </Text>
                )}
              </ScrollView>

              {/* Clone button */}
              <View style={s.cloneRow}>
                <Pressable
                  style={s.cloneBtn}
                  onPress={() => handleClone(previewTemplate)}
                  disabled={cloningId === previewTemplate.id}
                >
                  {cloningId === previewTemplate.id ? (
                    <ActivityIndicator size="small" color="#0E1117" />
                  ) : (
                    <>
                      <Icon name="copy" size={18} color="#0E1117" />
                      <Text style={s.cloneBtnText}>Clone to My Library</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '50%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A3347',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    flex: 1,
  },

  // Search
  searchRow: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },

  // Chips
  chipScroll: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  chipActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: '#F5A623',
  },
  chipText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#F5A623',
  },

  // Count
  countText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 10,
  },

  // Card
  card: {
    backgroundColor: '#0E1117',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    flex: 1,
  },
  cardDesc: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
  },
  cardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  cardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cardBadgeText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },

  // Loading / Empty
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
  },

  // Preview
  previewDesc: {
    fontSize: 14,
    color: '#C9D1D9',
    fontFamily: FB,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 8,
  },
  blockCard: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  blockName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  blockMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  tagsText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    fontStyle: 'italic',
  },

  // Clone
  cloneRow: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  cloneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
  },
  cloneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
});
