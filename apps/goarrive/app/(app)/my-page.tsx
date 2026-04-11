/**
 * My Page — Coach funnel landing page builder (preview-first)
 *
 * Coaches see a live preview of their page with defaults already filled in,
 * then tap directly on sections to edit them. Minimal friction, visual-first.
 */
import React, { useState, useEffect } from 'react';
import { router } from 'expo-router';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TextInput,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { BG, CARD, BORDER, MUTED, GOLD, GREEN, RED, FG, FH, FB } from '../../lib/theme';
import { mergeFunnelData, type FunnelData } from '../../lib/funnelDefaults';
import { FunnelPreview, type EditSection } from '../../components/funnel/FunnelPreview';
import { SectionEditor } from '../../components/funnel/SectionEditor';

const INPUT_BG = '#1A2035';
const INPUT_BORDER = '#2A3548';
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export default function MyPageScreen() {
  const { user, effectiveUid } = useAuth();
  const coachId = effectiveUid || user?.uid;
  const coachName = user?.displayName || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Core data
  const [data, setData] = useState<FunnelData>(mergeFunnelData(undefined));
  const [savedSubdomain, setSavedSubdomain] = useState('');
  const [subdomainError, setSubdomainError] = useState('');

  // Editor state
  const [activeEditor, setActiveEditor] = useState<EditSection | null>(null);

  // Advanced sections visibility
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!coachId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'coaches', coachId));
        const merged = mergeFunnelData(snap.exists() ? snap.data() : undefined);
        setData(merged);
        setSavedSubdomain(merged.funnelSubdomain);
      } catch (err) {
        console.error('[MyPage] load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [coachId]);

  // ── Subdomain helpers ───────────────────────────────────────────────
  function validateSubdomain(val: string): string {
    if (!val) return 'Subdomain is required';
    if (val.length < 3) return 'Must be at least 3 characters';
    if (val.length > 30) return 'Must be 30 characters or less';
    if (!SUBDOMAIN_RE.test(val))
      return 'Lowercase letters, numbers, and hyphens only';
    return '';
  }

  function handleSubdomainChange(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setData((prev) => ({ ...prev, funnelSubdomain: clean }));
    setSubdomainError(validateSubdomain(clean));
  }

  async function checkSubdomainUnique(slug: string): Promise<boolean> {
    if (slug === savedSubdomain) return true;
    const q = query(
      collection(db, 'coaches'),
      where('funnelSubdomain', '==', slug),
    );
    const snap = await getDocs(q);
    return snap.empty;
  }

  // ── Photo upload ────────────────────────────────────────────────────
  async function handlePhotoUpload() {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant media library access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingPhoto(true);
    try {
      const response = await fetch(result.assets[0].uri);
      const blob = await response.blob();
      const fileName = `funnel/${coachId}/photo/${Date.now()}.jpg`;
      const storageRef = ref(storage, fileName);
      const uploadTask = uploadBytesResumable(storageRef, blob, {
        contentType: 'image/jpeg',
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on('state_changed', null, reject, async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setData((prev) => ({ ...prev, funnelPhotoUrl: url }));
          resolve();
        });
      });
    } catch (err) {
      console.error('[MyPage] upload error:', err);
      Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validateSubdomain(data.funnelSubdomain);
    if (err) {
      setSubdomainError(err);
      return;
    }

    setSaving(true);
    try {
      const isUnique = await checkSubdomainUnique(data.funnelSubdomain);
      if (!isUnique) {
        setSubdomainError('This subdomain is already taken');
        setSaving(false);
        return;
      }

      const cleanBullets = data.funnelBullets
        .map((b) => b.trim())
        .filter(Boolean);
      const cleanTestimonials = data.funnelTestimonials.filter(
        (t) => t.name.trim() && t.text.trim(),
      );

      await setDoc(
        doc(db, 'coaches', coachId!),
        {
          funnelSubdomain: data.funnelSubdomain,
          funnelHeadline: data.funnelHeadline.trim(),
          funnelSubheadline: data.funnelSubheadline.trim(),
          funnelBullets: cleanBullets,
          funnelBio: data.funnelBio.trim(),
          funnelPhotoUrl: data.funnelPhotoUrl,
          funnelHeroVideoLink: data.funnelHeroVideoLink.trim(),
          // Auto-derive OG image from photo if no custom OG set
          funnelOgImageUrl: data.funnelOgImageUrl || data.funnelPhotoUrl,
          funnelTestimonials: cleanTestimonials,
          funnelUpdatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      setSavedSubdomain(data.funnelSubdomain);
      Alert.alert('Saved', 'Your page has been updated.');
    } catch (err) {
      console.error('[MyPage] save error:', err);
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Preview link ────────────────────────────────────────────────────
  function openPreview() {
    const url = `https://${data.funnelSubdomain || 'preview'}.goarrive.fit`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  }

  // Auto-generated OG metadata
  const ogTitle = `${coachName || 'Your Coach'} — Fitness Coach | GoArrive`;
  const ogDescription =
    data.funnelSubheadline.slice(0, 150) ||
    'Get a personalized fitness plan from a real coach.';

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Icon name="arrow-left" size={24} color={MUTED} />
        </Pressable>
        <Text style={s.headerTitle}>My Page</Text>
        <Pressable
          style={[s.saveHeaderBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={BG} />
          ) : (
            <Text style={s.saveHeaderText}>Save</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Subdomain ──────────────────────────────────── */}
        <Text style={s.sectionLabel}>Page URL</Text>
        <View style={s.subdomainRow}>
          <TextInput
            style={[s.subdomainInput, subdomainError ? s.inputError : null]}
            value={data.funnelSubdomain}
            onChangeText={handleSubdomainChange}
            placeholder="your-name"
            placeholderTextColor="#4A5568"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
          <Text style={s.subdomainSuffix}>.goarrive.fit</Text>
        </View>
        {subdomainError ? (
          <Text style={s.errorText}>{subdomainError}</Text>
        ) : data.funnelSubdomain ? (
          <Text style={s.urlPreview}>
            {data.funnelSubdomain}.goarrive.fit
          </Text>
        ) : null}

        {/* ── Photo Upload ───────────────────────────────── */}
        <Text style={[s.sectionLabel, { marginTop: 20 }]}>Coach Photo</Text>
        <Pressable
          style={s.photoRow}
          onPress={handlePhotoUpload}
          disabled={uploadingPhoto}
        >
          {data.funnelPhotoUrl ? (
            <Image
              source={{ uri: data.funnelPhotoUrl }}
              style={s.photoCircle}
            />
          ) : (
            <View style={[s.photoCircle, s.photoPlaceholder]}>
              <Icon name="camera" size={24} color={MUTED} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.photoLabel}>
              {uploadingPhoto
                ? 'Uploading...'
                : data.funnelPhotoUrl
                  ? 'Change Photo'
                  : 'Add Your Photo'}
            </Text>
            <Text style={s.photoHint}>
              Used in page header, bio section, and link previews
            </Text>
          </View>
          {uploadingPhoto ? (
            <ActivityIndicator size="small" color={GOLD} />
          ) : (
            <Icon name="upload" size={18} color={GOLD} />
          )}
        </Pressable>

        {/* ── Live Preview ───────────────────────────────── */}
        <View style={{ marginTop: 24 }}>
          <FunnelPreview
            data={data}
            coachName={coachName}
            onEditSection={setActiveEditor}
            maxHeight={560}
          />
        </View>

        {/* ── Share Preview (collapsible) ────────────────── */}
        <Pressable
          style={s.collapsibleHeader}
          onPress={() => setShowSharePreview(!showSharePreview)}
        >
          <View style={s.collapsibleLeft}>
            <Icon name="eye" size={16} color={MUTED} />
            <Text style={s.collapsibleTitle}>Share Preview</Text>
          </View>
          <Icon
            name={showSharePreview ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={MUTED}
          />
        </Pressable>
        {showSharePreview && (
          <View style={s.ogCard}>
            <Text style={s.ogHint}>
              How your page looks when shared via text or social media
            </Text>
            <View style={s.ogMock}>
              {data.funnelPhotoUrl ? (
                <Image
                  source={{ uri: data.funnelPhotoUrl }}
                  style={s.ogThumb}
                />
              ) : (
                <View style={[s.ogThumb, { backgroundColor: '#2A3548' }]} />
              )}
              <View style={s.ogText}>
                <Text style={s.ogMockTitle} numberOfLines={1}>
                  {ogTitle}
                </Text>
                <Text style={s.ogMockDesc} numberOfLines={2}>
                  {ogDescription}
                </Text>
                <Text style={s.ogMockUrl}>
                  {data.funnelSubdomain || 'your-name'}.goarrive.fit
                </Text>
              </View>
            </View>
            <Text style={s.ogAutoNote}>
              Auto-generated from your content. Customize below if needed.
            </Text>
          </View>
        )}

        {/* ── Advanced (collapsible) ─────────────────────── */}
        <Pressable
          style={s.collapsibleHeader}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <View style={s.collapsibleLeft}>
            <Icon name="settings" size={16} color={MUTED} />
            <Text style={s.collapsibleTitle}>Advanced</Text>
          </View>
          <Icon
            name={showAdvanced ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={MUTED}
          />
        </Pressable>
        {showAdvanced && (
          <View style={s.advancedCard}>
            <Text style={s.fieldLabel}>Hero Video URL</Text>
            <Text style={s.fieldHint}>
              YouTube or Vimeo embed URL — replaces photo in hero
            </Text>
            <TextInput
              style={s.advancedInput}
              value={data.funnelHeroVideoLink}
              onChangeText={(t) =>
                setData((prev) => ({ ...prev, funnelHeroVideoLink: t }))
              }
              placeholder="https://youtube.com/embed/..."
              placeholderTextColor="#4A5568"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {/* ── Bottom Actions ─────────────────────────────── */}
        <View style={s.actionRow}>
          <Pressable
            style={[s.previewBtn, !data.funnelSubdomain && { opacity: 0.4 }]}
            onPress={openPreview}
            disabled={!data.funnelSubdomain}
          >
            <Icon name="external-link" size={16} color={GOLD} />
            <Text style={s.previewBtnText}>View Live Page</Text>
          </Pressable>

          <Pressable
            style={[s.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={BG} />
            ) : (
              <Text style={s.saveBtnText}>Save Changes</Text>
            )}
          </Pressable>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Editor bottom sheet */}
      <SectionEditor
        visible={!!activeEditor}
        section={activeEditor}
        data={data}
        onUpdate={setData}
        onClose={() => setActiveEditor(null)}
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  loadingWrap: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingTop: Platform.select({ ios: 56, android: 16, default: 16 }),
    ...(Platform.OS === 'web'
      ? ({ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' } as any)
      : {}),
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: FG, fontFamily: FH },
  saveHeaderBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  saveHeaderText: { fontSize: 14, fontWeight: '700', color: BG, fontFamily: FB },
  scroll: { flex: 1 },
  content: { padding: 20 },

  // Subdomain
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  subdomainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  subdomainInput: {
    flex: 1,
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: FG,
    fontFamily: FB,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: INPUT_BORDER,
  },
  subdomainSuffix: {
    backgroundColor: '#151B28',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: INPUT_BORDER,
  },
  inputError: { borderColor: RED },
  errorText: { fontSize: 12, color: RED, fontFamily: FB, marginTop: 4 },
  urlPreview: { fontSize: 12, color: GREEN, fontFamily: FB, marginTop: 4 },

  // Photo
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  photoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1A2035',
  },
  photoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#3A4558',
  },
  photoLabel: { fontSize: 14, fontWeight: '600', color: FG, fontFamily: FB },
  photoHint: { fontSize: 11, color: MUTED, fontFamily: FB, marginTop: 2 },

  // Collapsibles
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  collapsibleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapsibleTitle: { fontSize: 14, fontWeight: '600', color: FG, fontFamily: FB },

  // OG Preview
  ogCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  ogHint: { fontSize: 12, color: MUTED, fontFamily: FB, marginBottom: 12 },
  ogMock: {
    flexDirection: 'row',
    backgroundColor: '#1A2035',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  ogThumb: { width: 80, height: 80, backgroundColor: '#0E1117' },
  ogText: { flex: 1, padding: 10, justifyContent: 'center' },
  ogMockTitle: { fontSize: 12, fontWeight: '700', color: FG, fontFamily: FB },
  ogMockDesc: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginTop: 2,
    lineHeight: 15,
  },
  ogMockUrl: {
    fontSize: 10,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 4,
  },
  ogAutoNote: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginTop: 10,
    fontStyle: 'italic',
  },

  // Advanced
  advancedCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: FG, fontFamily: FB, marginBottom: 4 },
  fieldHint: { fontSize: 12, color: MUTED, fontFamily: FB, marginBottom: 10 },
  advancedInput: {
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 10,
    paddingVertical: 14,
  },
  previewBtnText: { fontSize: 15, fontWeight: '600', color: GOLD, fontFamily: FB },
  saveBtn: {
    flex: 1,
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: BG, fontFamily: FB },
});
