/**
 * My Page — Coach funnel landing page settings
 *
 * Allows coaches to configure their public landing page at {slug}.goarrive.fit.
 * Reads/writes funnel fields on the users/{uid} document in Firestore.
 */
import React, { useState, useEffect, useCallback } from 'react';
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

const CARD_BG = '#1A2035';
const INPUT_BORDER = '#2A3548';
const TEXT_SECONDARY = '#8A95A3';

interface Testimonial {
  name: string;
  text: string;
}

export default function MyPageScreen() {
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || user?.uid;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fields
  const [subdomain, setSubdomain] = useState('');
  const [savedSubdomain, setSavedSubdomain] = useState('');
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [bullets, setBullets] = useState<string[]>(['']);
  const [bio, setBio] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [heroVideoLink, setHeroVideoLink] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);

  // Upload states
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingOg, setUploadingOg] = useState(false);

  // Validation
  const [subdomainError, setSubdomainError] = useState('');

  // ── Load existing data ──────────────────────────────────────────────
  useEffect(() => {
    if (!coachId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'coaches', coachId));
        if (snap.exists()) {
          const d = snap.data();
          setSubdomain(d.funnelSubdomain || '');
          setSavedSubdomain(d.funnelSubdomain || '');
          setHeadline(d.funnelHeadline || '');
          setSubheadline(d.funnelSubheadline || '');
          setBullets(d.funnelBullets?.length ? d.funnelBullets : ['']);
          setBio(d.funnelBio || '');
          setPhotoUrl(d.funnelPhotoUrl || '');
          setHeroVideoLink(d.funnelHeroVideoLink || '');
          setOgImageUrl(d.funnelOgImageUrl || '');
          setTestimonials(d.funnelTestimonials?.length ? d.funnelTestimonials : []);
        }
      } catch (err) {
        console.error('[MyPage] load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [coachId]);

  // ── Subdomain validation ────────────────────────────────────────────
  const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

  function validateSubdomain(val: string): string {
    if (!val) return 'Subdomain is required';
    if (val.length < 3) return 'Must be at least 3 characters';
    if (val.length > 30) return 'Must be 30 characters or less';
    if (!SUBDOMAIN_RE.test(val)) return 'Lowercase letters, numbers, and hyphens only';
    return '';
  }

  function handleSubdomainChange(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setSubdomain(clean);
    setSubdomainError(validateSubdomain(clean));
  }

  // ── Uniqueness check ────────────────────────────────────────────────
  async function checkSubdomainUnique(slug: string): Promise<boolean> {
    if (slug === savedSubdomain) return true; // unchanged
    const q = query(
      collection(db, 'coaches'),
      where('funnelSubdomain', '==', slug),
    );
    const snap = await getDocs(q);
    return snap.empty;
  }

  // ── Image upload helper ─────────────────────────────────────────────
  async function pickAndUploadImage(
    folder: string,
    setUrl: (url: string) => void,
    setUploading: (v: boolean) => void,
    aspect?: [number, number],
  ) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant media library access.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 0.85,
    });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const fileName = `funnel/${coachId}/${folder}/${Date.now()}.jpg`;
      const storageRef = ref(storage, fileName);
      const uploadTask = uploadBytesResumable(storageRef, blob, {
        contentType: 'image/jpeg',
      });

      await new Promise<void>((resolve, reject) => {
        uploadTask.on('state_changed', null, reject, async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          setUrl(url);
          resolve();
        });
      });
    } catch (err) {
      console.error('[MyPage] upload error:', err);
      Alert.alert('Upload Failed', 'Could not upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validateSubdomain(subdomain);
    if (err) {
      setSubdomainError(err);
      return;
    }

    setSaving(true);
    try {
      const isUnique = await checkSubdomainUnique(subdomain);
      if (!isUnique) {
        setSubdomainError('This subdomain is already taken');
        setSaving(false);
        return;
      }

      // Filter empty bullets
      const cleanBullets = bullets.map((b) => b.trim()).filter(Boolean);

      // Filter incomplete testimonials
      const cleanTestimonials = testimonials.filter(
        (t) => t.name.trim() && t.text.trim(),
      );

      await setDoc(
        doc(db, 'coaches', coachId!),
        {
          funnelSubdomain: subdomain,
          funnelHeadline: headline.trim(),
          funnelSubheadline: subheadline.trim(),
          funnelBullets: cleanBullets,
          funnelBio: bio.trim(),
          funnelPhotoUrl: photoUrl,
          funnelHeroVideoLink: heroVideoLink.trim(),
          funnelOgImageUrl: ogImageUrl,
          funnelTestimonials: cleanTestimonials,
          funnelUpdatedAt: Timestamp.now(),
        },
        { merge: true },
      );

      setSavedSubdomain(subdomain);
      Alert.alert('Saved', 'Your page settings have been saved.');
    } catch (err) {
      console.error('[MyPage] save error:', err);
      Alert.alert('Error', 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Bullet helpers ──────────────────────────────────────────────────
  function updateBullet(index: number, text: string) {
    const next = [...bullets];
    next[index] = text;
    setBullets(next);
  }

  function removeBullet(index: number) {
    setBullets(bullets.filter((_, i) => i !== index));
  }

  function addBullet() {
    if (bullets.length < 4) setBullets([...bullets, '']);
  }

  // ── Testimonial helpers ─────────────────────────────────────────────
  function updateTestimonial(index: number, field: 'name' | 'text', value: string) {
    const next = [...testimonials];
    next[index] = { ...next[index], [field]: value };
    setTestimonials(next);
  }

  function removeTestimonial(index: number) {
    setTestimonials(testimonials.filter((_, i) => i !== index));
  }

  function addTestimonial() {
    if (testimonials.length < 5) setTestimonials([...testimonials, { name: '', text: '' }]);
  }

  // ── Preview ─────────────────────────────────────────────────────────
  function openPreview() {
    const url = `https://${subdomain || 'preview'}.goarrive.fit`;
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  }

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
          onPress={openPreview}
          hitSlop={8}
          disabled={!subdomain}
          style={{ opacity: subdomain ? 1 : 0.4 }}
        >
          <Icon name="share" size={22} color={GOLD} />
        </Pressable>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {/* ── Page URL ────────────────────────────────────── */}
        <Text style={s.sectionTitle}>Page URL</Text>
        <View style={s.card}>
          <Text style={s.label}>Subdomain</Text>
          <TextInput
            style={[s.input, subdomainError ? s.inputError : null]}
            value={subdomain}
            onChangeText={handleSubdomainChange}
            placeholder="your-name"
            placeholderTextColor="#4A5568"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
          {subdomainError ? (
            <Text style={s.errorText}>{subdomainError}</Text>
          ) : null}
          {subdomain ? (
            <Text style={s.previewUrl}>{subdomain}.goarrive.fit</Text>
          ) : null}
        </View>

        {/* ── Hero Section ────────────────────────────────── */}
        <Text style={s.sectionTitle}>Hero</Text>
        <View style={s.card}>
          <Text style={s.label}>Coach Photo</Text>
          <Text style={s.hint}>Portrait orientation (3:4), minimum 600px wide</Text>
          <Pressable
            style={s.uploadBtn}
            onPress={() => pickAndUploadImage('photo', setPhotoUrl, setUploadingPhoto, [3, 4])}
            disabled={uploadingPhoto}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={BG} />
            ) : (
              <>
                <Icon name="image" size={18} color={BG} />
                <Text style={s.uploadBtnText}>
                  {photoUrl ? 'Replace Photo' : 'Upload Photo'}
                </Text>
              </>
            )}
          </Pressable>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={s.photoPreview} />
          ) : null}

          <View style={s.fieldGap} />
          <Text style={s.label}>Hero Video URL (optional)</Text>
          <Text style={s.hint}>YouTube or Vimeo embed URL — replaces photo in hero</Text>
          <TextInput
            style={s.input}
            value={heroVideoLink}
            onChangeText={setHeroVideoLink}
            placeholder="https://youtube.com/embed/..."
            placeholderTextColor="#4A5568"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── Content ─────────────────────────────────────── */}
        <Text style={s.sectionTitle}>Content</Text>
        <View style={s.card}>
          <Text style={s.label}>Headline</Text>
          <TextInput
            style={s.input}
            value={headline}
            onChangeText={(t) => setHeadline(t.slice(0, 60))}
            placeholder="Your Fitness Plan, Built Just for You"
            placeholderTextColor="#4A5568"
            maxLength={60}
          />
          <Text style={s.charCount}>{headline.length}/60</Text>

          <View style={s.fieldGap} />
          <Text style={s.label}>Subheadline</Text>
          <TextInput
            style={[s.input, s.textArea]}
            value={subheadline}
            onChangeText={(t) => setSubheadline(t.slice(0, 200))}
            placeholder="A short description of your coaching approach"
            placeholderTextColor="#4A5568"
            multiline
            maxLength={200}
          />
          <Text style={s.charCount}>{subheadline.length}/200</Text>

          <View style={s.fieldGap} />
          <Text style={s.label}>Value Prop Bullets (max 4)</Text>
          {bullets.map((b, i) => (
            <View key={i} style={s.bulletRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={b}
                onChangeText={(t) => updateBullet(i, t.slice(0, 80))}
                placeholder={`Bullet ${i + 1}`}
                placeholderTextColor="#4A5568"
                maxLength={80}
              />
              {bullets.length > 1 ? (
                <Pressable onPress={() => removeBullet(i)} hitSlop={8} style={s.removeBtn}>
                  <Icon name="x" size={16} color={RED} />
                </Pressable>
              ) : null}
            </View>
          ))}
          {bullets.length < 4 ? (
            <Pressable style={s.addBtn} onPress={addBullet}>
              <Icon name="plus" size={14} color={GOLD} />
              <Text style={s.addBtnText}>Add Bullet</Text>
            </Pressable>
          ) : null}

          <View style={s.fieldGap} />
          <Text style={s.label}>Bio</Text>
          <TextInput
            style={[s.input, s.textArea]}
            value={bio}
            onChangeText={(t) => setBio(t.slice(0, 300))}
            placeholder="A short bio about your coaching background"
            placeholderTextColor="#4A5568"
            multiline
            maxLength={300}
          />
          <Text style={s.charCount}>{bio.length}/300</Text>
        </View>

        {/* ── Testimonials ────────────────────────────────── */}
        <Text style={s.sectionTitle}>Testimonials</Text>
        <View style={s.card}>
          <Text style={s.hint}>Add up to 5 testimonials. Leave empty to use defaults.</Text>
          {testimonials.map((t, i) => (
            <View key={i} style={s.testimonialCard}>
              <View style={s.testimonialHeader}>
                <Text style={s.testimonialLabel}>Testimonial {i + 1}</Text>
                <Pressable onPress={() => removeTestimonial(i)} hitSlop={8}>
                  <Icon name="x" size={16} color={RED} />
                </Pressable>
              </View>
              <TextInput
                style={s.input}
                value={t.name}
                onChangeText={(v) => updateTestimonial(i, 'name', v)}
                placeholder="Name"
                placeholderTextColor="#4A5568"
              />
              <TextInput
                style={[s.input, s.textArea, { marginTop: 8 }]}
                value={t.text}
                onChangeText={(v) => updateTestimonial(i, 'text', v)}
                placeholder="Testimonial text"
                placeholderTextColor="#4A5568"
                multiline
              />
            </View>
          ))}
          {testimonials.length < 5 ? (
            <Pressable style={s.addBtn} onPress={addTestimonial}>
              <Icon name="plus" size={14} color={GOLD} />
              <Text style={s.addBtnText}>Add Testimonial</Text>
            </Pressable>
          ) : null}
        </View>

        {/* ── Link Preview ────────────────────────────────── */}
        <Text style={s.sectionTitle}>Link Preview (OG Image)</Text>
        <View style={s.card}>
          <Text style={s.hint}>1200x630 image for iMessage / social link previews</Text>
          <Pressable
            style={s.uploadBtn}
            onPress={() => pickAndUploadImage('og', setOgImageUrl, setUploadingOg, [120, 63])}
            disabled={uploadingOg}
          >
            {uploadingOg ? (
              <ActivityIndicator size="small" color={BG} />
            ) : (
              <>
                <Icon name="image" size={18} color={BG} />
                <Text style={s.uploadBtnText}>
                  {ogImageUrl ? 'Replace OG Image' : 'Upload OG Image'}
                </Text>
              </>
            )}
          </Pressable>
          {ogImageUrl ? (
            <Image source={{ uri: ogImageUrl }} style={s.ogPreview} />
          ) : null}
        </View>

        {/* ── Preview + Save ──────────────────────────────── */}
        <View style={s.actionRow}>
          <Pressable
            style={[s.previewBtn, !subdomain && { opacity: 0.4 }]}
            onPress={openPreview}
            disabled={!subdomain}
          >
            <Icon name="share" size={16} color={GOLD} />
            <Text style={s.previewBtnText}>Preview Page</Text>
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
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
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
    paddingTop: Platform.select({
      ios: 56,
      android: 16,
      default: 16,
    }),
    ...(Platform.OS === 'web'
      ? ({ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' } as any)
      : {}),
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
    marginTop: 24,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: FG,
    fontFamily: FB,
    marginBottom: 6,
  },
  hint: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 10,
    lineHeight: 17,
  },
  input: {
    backgroundColor: CARD_BG,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: FG,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  inputError: {
    borderColor: RED,
  },
  textArea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 12,
    color: RED,
    fontFamily: FB,
    marginTop: 4,
  },
  previewUrl: {
    fontSize: 13,
    color: GREEN,
    fontFamily: FB,
    marginTop: 6,
  },
  charCount: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    textAlign: 'right',
    marginTop: 4,
  },
  fieldGap: {
    height: 16,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  removeBtn: {
    padding: 6,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  uploadBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: BG,
    fontFamily: FB,
  },
  photoPreview: {
    width: 120,
    height: 160,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: CARD_BG,
  },
  ogPreview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    marginTop: 12,
    backgroundColor: CARD_BG,
    resizeMode: 'cover',
  },
  testimonialCard: {
    backgroundColor: CARD_BG,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  testimonialHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  testimonialLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
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
  previewBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: BG,
    fontFamily: FB,
  },
});
