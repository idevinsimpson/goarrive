/**
 * AdminCommsTab — platformAdmin surface for the coach comms loop.
 *
 * 1. Coach Feedback: coach_feedback docs newest-first with admin status
 *    transitions (new/reviewing/planned/shipped/declined).
 * 2. Release Notes: create/edit platform_releases (draft/queued) — queued
 *    releases go out in the Monday What's New digest.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';

const FONT_HEADING = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CARD_BG = '#1A2035';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const RED = '#E05252';
const BLUE = '#5B9BD5';
const PURPLE = '#A78BFA';
const MUTED = '#8A95A3';
const FG = '#F0F4F8';

const FEEDBACK_STATUSES = ['new', 'reviewing', 'planned', 'shipped', 'declined'] as const;
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  new: GOLD,
  reviewing: BLUE,
  planned: PURPLE,
  shipped: GREEN,
  declined: RED,
};

interface FeedbackRow {
  id: string;
  coachName: string;
  coachEmail: string;
  category: string;
  message: string;
  status: FeedbackStatus;
  createdAt?: any;
}

interface ReleaseFeature {
  name: string;
  blurb: string;
  deepLink: string;
}

interface ReleaseRow {
  id: string;
  title: string;
  bodyMarkdown: string;
  features: ReleaseFeature[];
  status: string;
  createdAt?: any;
  sentAt?: any;
}

const EMPTY_FEATURE: ReleaseFeature = { name: '', blurb: '', deepLink: '' };

function formatDate(ts: any): string {
  const d = ts?.toDate?.();
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminCommsTab() {
  // ── Feedback state ──
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [feedbackShown, setFeedbackShown] = useState(25);

  // ── Releases state ──
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // 'new' = create
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formStatus, setFormStatus] = useState<'draft' | 'queued'>('draft');
  const [formFeatures, setFormFeatures] = useState<ReleaseFeature[]>([{ ...EMPTY_FEATURE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeedback = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'coach_feedback'), orderBy('createdAt', 'desc'), limit(200)),
      );
      setFeedback(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            coachName: data.coachName || '',
            coachEmail: data.coachEmail || '',
            category: data.category || 'idea',
            message: data.message || '',
            status: (FEEDBACK_STATUSES as readonly string[]).includes(data.status)
              ? data.status
              : 'new',
            createdAt: data.createdAt,
          };
        }),
      );
    } catch (err) {
      console.error('[AdminCommsTab] feedback load error:', err);
    } finally {
      setLoadingFeedback(false);
    }
  }, []);

  const fetchReleases = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'platform_releases'));
      setReleases(
        snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              title: data.title || '',
              bodyMarkdown: data.bodyMarkdown || '',
              features: Array.isArray(data.features) ? data.features : [],
              status: data.status || 'draft',
              createdAt: data.createdAt,
              sentAt: data.sentAt,
            };
          })
          .sort(
            (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0),
          ),
      );
    } catch (err) {
      console.error('[AdminCommsTab] releases load error:', err);
    } finally {
      setLoadingReleases(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback();
    fetchReleases();
  }, [fetchFeedback, fetchReleases]);

  async function setFeedbackStatus(id: string, status: FeedbackStatus) {
    const prev = feedback;
    setFeedback((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await updateDoc(doc(db, 'coach_feedback', id), { status });
    } catch (err) {
      console.error('[AdminCommsTab] status update error:', err);
      setFeedback(prev);
    }
  }

  function openEditor(release?: ReleaseRow) {
    setError(null);
    if (release) {
      setEditingId(release.id);
      setFormTitle(release.title);
      setFormBody(release.bodyMarkdown);
      setFormStatus(release.status === 'queued' ? 'queued' : 'draft');
      setFormFeatures(
        release.features.length > 0
          ? release.features.map((f) => ({
              name: f.name || '',
              blurb: f.blurb || '',
              deepLink: f.deepLink || '',
            }))
          : [{ ...EMPTY_FEATURE }],
      );
    } else {
      setEditingId('new');
      setFormTitle('');
      setFormBody('');
      setFormStatus('draft');
      setFormFeatures([{ ...EMPTY_FEATURE }]);
    }
  }

  async function saveRelease() {
    if (!formTitle.trim()) {
      setError('Title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      title: formTitle.trim(),
      bodyMarkdown: formBody.trim(),
      features: formFeatures
        .filter((f) => f.name.trim())
        .map((f) => ({
          name: f.name.trim(),
          blurb: f.blurb.trim(),
          ...(f.deepLink.trim() ? { deepLink: f.deepLink.trim() } : {}),
        })),
      status: formStatus,
    };
    try {
      if (editingId === 'new') {
        await addDoc(collection(db, 'platform_releases'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      } else if (editingId) {
        await updateDoc(doc(db, 'platform_releases', editingId), payload);
      }
      setEditingId(null);
      await fetchReleases();
    } catch (err: any) {
      console.error('[AdminCommsTab] save release error:', err);
      setError(err?.message || 'Failed to save release.');
    } finally {
      setSaving(false);
    }
  }

  function updateFeature(index: number, patch: Partial<ReleaseFeature>) {
    setFormFeatures((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  const visibleFeedback = feedback.slice(0, feedbackShown);

  return (
    <View style={s.wrap}>
      {/* ── Release Notes ── */}
      <View style={s.sectionCard}>
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>{"Release Notes (What's New)"}</Text>
          <Pressable style={s.newBtn} onPress={() => openEditor()}>
            <Icon name="plus" size={14} color="#0E1117" />
            <Text style={s.newBtnText}>New Release</Text>
          </Pressable>
        </View>
        <Text style={s.sectionHint}>
          Queued releases go out in the Monday 9AM digest to all active coaches, then flip to
          sent. Drafts stay put until you queue them.
        </Text>

        {editingId !== null && (
          <View style={s.editor}>
            <Text style={s.inputLabel}>Title</Text>
            <TextInput
              style={s.input}
              placeholder="You can now share ideas straight from your dashboard"
              placeholderTextColor="#4A5568"
              value={formTitle}
              onChangeText={setFormTitle}
            />
            <Text style={s.inputLabel}>Body (markdown, **bold** supported)</Text>
            <TextInput
              style={[s.input, s.multiline]}
              placeholder="What changed and why it helps coaches…"
              placeholderTextColor="#4A5568"
              value={formBody}
              onChangeText={setFormBody}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <Text style={s.inputLabel}>Features</Text>
            {formFeatures.map((f, i) => (
              <View key={i} style={s.featureEditor}>
                <View style={s.featureEditorHeader}>
                  <Text style={s.featureEditorLabel}>Feature {i + 1}</Text>
                  {formFeatures.length > 1 && (
                    <Pressable
                      onPress={() => setFormFeatures((prev) => prev.filter((_, j) => j !== i))}
                      hitSlop={8}
                    >
                      <Icon name="x" size={14} color={MUTED} />
                    </Pressable>
                  )}
                </View>
                <TextInput
                  style={s.input}
                  placeholder="Feature name"
                  placeholderTextColor="#4A5568"
                  value={f.name}
                  onChangeText={(t) => updateFeature(i, { name: t })}
                />
                <TextInput
                  style={[s.input, s.multilineSmall]}
                  placeholder="One-sentence blurb: what it does for the coach"
                  placeholderTextColor="#4A5568"
                  value={f.blurb}
                  onChangeText={(t) => updateFeature(i, { blurb: t })}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
                <TextInput
                  style={s.input}
                  placeholder="Deep link (optional), e.g. https://goarrive.fit/feedback"
                  placeholderTextColor="#4A5568"
                  value={f.deepLink}
                  onChangeText={(t) => updateFeature(i, { deepLink: t })}
                  autoCapitalize="none"
                />
              </View>
            ))}
            <Pressable
              style={s.addFeatureBtn}
              onPress={() => setFormFeatures((prev) => [...prev, { ...EMPTY_FEATURE }])}
            >
              <Icon name="plus" size={13} color={GOLD} />
              <Text style={s.addFeatureText}>Add feature</Text>
            </Pressable>

            <Text style={s.inputLabel}>Status</Text>
            <View style={s.chipRow}>
              {(['draft', 'queued'] as const).map((st) => (
                <Pressable
                  key={st}
                  style={[s.chip, formStatus === st && s.chipActive]}
                  onPress={() => setFormStatus(st)}
                >
                  <Text style={[s.chipText, formStatus === st && s.chipTextActive]}>
                    {st === 'draft' ? 'Draft' : 'Queued for Monday'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error && <Text style={s.errorText}>{error}</Text>}

            <View style={s.editorActions}>
              <Pressable style={s.cancelBtn} onPress={() => setEditingId(null)}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveRelease}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#0E1117" />
                ) : (
                  <Text style={s.saveBtnText}>
                    {editingId === 'new' ? 'Create Release' : 'Save Changes'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {loadingReleases ? (
          <ActivityIndicator size="small" color={GOLD} style={{ marginTop: 12 }} />
        ) : releases.length === 0 ? (
          <Text style={s.emptyText}>No releases yet. Create one to feed the Monday digest.</Text>
        ) : (
          releases.map((r) => (
            <View key={r.id} style={s.releaseRow}>
              <View style={s.releaseRowLeft}>
                <Text style={s.releaseRowTitle}>{r.title || '(untitled)'}</Text>
                <Text style={s.releaseRowMeta}>
                  {r.features.length} feature{r.features.length !== 1 ? 's' : ''} ·{' '}
                  {r.status === 'sent' ? `sent ${formatDate(r.sentAt)}` : formatDate(r.createdAt)}
                </Text>
              </View>
              <View
                style={[
                  s.statusBadge,
                  {
                    borderColor:
                      r.status === 'sent' ? GREEN : r.status === 'queued' ? GOLD : MUTED,
                  },
                ]}
              >
                <Text
                  style={[
                    s.statusBadgeText,
                    { color: r.status === 'sent' ? GREEN : r.status === 'queued' ? GOLD : MUTED },
                  ]}
                >
                  {r.status.toUpperCase()}
                </Text>
              </View>
              {r.status !== 'sent' && (
                <Pressable style={s.editBtn} onPress={() => openEditor(r)} hitSlop={6}>
                  <Text style={s.editBtnText}>Edit</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>

      {/* ── Coach Feedback ── */}
      <View style={s.sectionCard}>
        <Text style={s.sectionTitle}>Coach Feedback</Text>
        <Text style={s.sectionHint}>
          Ideas, improvements, and bugs from coaches — newest first.
        </Text>

        {loadingFeedback ? (
          <ActivityIndicator size="small" color={GOLD} style={{ marginTop: 12 }} />
        ) : feedback.length === 0 ? (
          <Text style={s.emptyText}>No coach feedback yet.</Text>
        ) : (
          <>
            {visibleFeedback.map((row) => (
              <View key={row.id} style={s.feedbackRow}>
                <View style={s.feedbackHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.feedbackCoach}>
                      {row.coachName || 'Unknown coach'}
                      {row.coachEmail ? `  ·  ${row.coachEmail}` : ''}
                    </Text>
                    <Text style={s.feedbackMeta}>
                      {row.category} · {formatDate(row.createdAt)}
                    </Text>
                  </View>
                  <View style={[s.statusBadge, { borderColor: STATUS_COLORS[row.status] }]}>
                    <Text style={[s.statusBadgeText, { color: STATUS_COLORS[row.status] }]}>
                      {row.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={s.feedbackMessage}>{row.message}</Text>
                <View style={s.chipRow}>
                  {FEEDBACK_STATUSES.map((st) => (
                    <Pressable
                      key={st}
                      style={[s.chip, row.status === st && s.chipActive]}
                      onPress={() => row.status !== st && setFeedbackStatus(row.id, st)}
                    >
                      <Text style={[s.chipText, row.status === st && s.chipTextActive]}>{st}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            {feedback.length > feedbackShown && (
              <Pressable style={s.loadMoreBtn} onPress={() => setFeedbackShown((n) => n + 25)}>
                <Text style={s.loadMoreText}>
                  Show more ({feedback.length - feedbackShown} remaining)
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 16, marginTop: 12 },
  sectionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: FG,
    fontFamily: FONT_HEADING,
  },
  sectionHint: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
    lineHeight: 17,
  },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  newBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_BODY,
  },
  editor: {
    backgroundColor: '#0E1320',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FONT_BODY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: FG,
    fontFamily: FONT_BODY,
  },
  multiline: { minHeight: 90 },
  multilineSmall: { minHeight: 52 },
  featureEditor: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  featureEditorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  featureEditorLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    fontFamily: FONT_BODY,
    letterSpacing: 0.5,
  },
  addFeatureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  addFeatureText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FONT_BODY,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.5)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  chipTextActive: { color: GOLD },
  errorText: {
    fontSize: 13,
    color: RED,
    fontFamily: FONT_BODY,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  saveBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minWidth: 120,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_BODY,
  },
  emptyText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FONT_BODY,
    marginTop: 8,
  },
  releaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingVertical: 10,
  },
  releaseRowLeft: { flex: 1, gap: 2 },
  releaseRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: FG,
    fontFamily: FONT_BODY,
  },
  releaseRowMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: FONT_BODY,
    letterSpacing: 0.5,
  },
  editBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: FG,
    fontFamily: FONT_BODY,
  },
  feedbackRow: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingVertical: 12,
    gap: 8,
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  feedbackCoach: {
    fontSize: 14,
    fontWeight: '600',
    color: FG,
    fontFamily: FONT_BODY,
  },
  feedbackMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FONT_BODY,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  feedbackMessage: {
    fontSize: 14,
    color: '#C8D0DA',
    fontFamily: FONT_BODY,
    lineHeight: 20,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FONT_BODY,
  },
});
