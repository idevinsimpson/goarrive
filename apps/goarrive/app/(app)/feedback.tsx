/**
 * Feedback screen — coaches share ideas, improvements, and bug reports.
 *
 * Writes to coach_feedback; the onCoachFeedbackCreated Cloud Function sends
 * an instant branded acknowledgment email.
 */
import React, { useState } from 'react';
import { router } from 'expo-router';
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { useEffectiveProfile } from '../../lib/useEffectiveProfile';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const GOLD = '#F5A623';
const GREEN = '#48BB78';
const BORDER = '#2A3347';
const CARD_BG = '#1A2035';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#8A95A3';
const TEXT_MUTED = '#718096';

type FeedbackCategory = 'idea' | 'improvement' | 'bug' | 'other';

const CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'idea', label: 'Idea' },
  { key: 'improvement', label: 'Improvement' },
  { key: 'bug', label: 'Bug' },
  { key: 'other', label: 'Other' },
];

export default function FeedbackScreen() {
  const insets = useSafeAreaInsets();
  const { user, claims, effectiveUid } = useAuth();
  const { displayName, email } = useEffectiveProfile();

  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [screenshots, setScreenshots] = useState<{ uri: string; mimeType?: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // effectiveUid (not user.uid) so admin impersonation attributes feedback
  // to the impersonated coach.
  const coachId = effectiveUid || claims?.coachId || user?.uid;

  const MAX_SCREENSHOTS = 3;

  async function handleAddScreenshot() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_SCREENSHOTS - screenshots.length,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      setScreenshots((prev) =>
        [...prev, ...result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType }))]
          .slice(0, MAX_SCREENSHOTS),
      );
    } catch (err) {
      console.error('[Feedback] screenshot pick error:', err);
      setError('Could not open your photo library. Please try again.');
    }
  }

  function handleRemoveScreenshot(uri: string) {
    setScreenshots((prev) => prev.filter((sIt) => sIt.uri !== uri));
  }

  async function uploadScreenshots(): Promise<string[]> {
    // Storage rules scope writes to the authenticated uid — always the real
    // signed-in user, even when an admin is impersonating a coach.
    const uid = user?.uid;
    if (!uid) return [];
    const urls: string[] = [];
    for (let i = 0; i < screenshots.length; i++) {
      const shot = screenshots[i];
      const blob = await (await fetch(shot.uri)).blob();
      const ext = (shot.mimeType?.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `feedback_screenshots/${uid}/${Date.now()}_${i}.${ext}`;
      const storageRef = ref(storage, path);
      const task = uploadBytesResumable(storageRef, blob, {
        contentType: shot.mimeType || 'image/jpeg',
      });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', undefined, reject, () => resolve());
      });
      urls.push(await getDownloadURL(storageRef));
    }
    return urls;
  }

  async function handleSubmit() {
    if (!message.trim() || !coachId) return;
    setSubmitting(true);
    setError(null);
    try {
      const screenshotUrls = await uploadScreenshots();
      await addDoc(collection(db, 'coach_feedback'), {
        coachId,
        coachName: displayName || '',
        coachEmail: email || '',
        message: message.trim(),
        category,
        screenshotUrls,
        status: 'new',
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
      setScreenshots([]);
    } catch (err) {
      console.error('[Feedback] submit error:', err);
      setError('Something went wrong sending your feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    router.back();
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
        <Pressable onPress={handleBack} hitSlop={8}>
          <Icon name="arrow-left" size={24} color={TEXT_SECONDARY} />
        </Pressable>
        <Text style={s.headerTitle}>Share Feedback</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {submitted ? (
          <View style={s.card}>
            <View style={s.confirmIconWrap}>
              <Icon name="check" size={28} color={GREEN} />
            </View>
            <Text style={s.confirmTitle}>Got it — we're taking a look</Text>
            <Text style={s.confirmText}>
              Thanks for helping shape GoArrive. We read every piece of coach
              feedback, and you'll get a confirmation email shortly.
            </Text>
            <View style={s.confirmActions}>
              <Pressable
                style={s.secondaryBtn}
                onPress={() => {
                  setMessage('');
                  setCategory('idea');
                  setSubmitted(false);
                }}
              >
                <Text style={s.secondaryBtnText}>Share another</Text>
              </Pressable>
              <Pressable style={s.submitBtn} onPress={handleBack}>
                <Text style={s.submitBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.title}>What's on your mind?</Text>
            <Text style={s.subtitle}>
              Ideas, improvements, bugs — your feedback goes straight to the
              team building GoArrive.
            </Text>

            <Text style={s.inputLabel}>Category</Text>
            <View style={s.categoryRow}>
              {CATEGORIES.map((cat) => {
                const active = category === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    style={[s.categoryChip, active && s.categoryChipActive]}
                    onPress={() => setCategory(cat.key)}
                  >
                    <Text
                      style={[s.categoryChipText, active && s.categoryChipTextActive]}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.inputLabel}>Your message</Text>
            <TextInput
              style={s.messageInput}
              placeholder={
                category === 'bug'
                  ? 'What happened, and what did you expect?'
                  : 'Tell us your idea — what would make GoArrive better for you or your members?'
              }
              placeholderTextColor={TEXT_MUTED}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />

            <Text style={s.inputLabel}>Screenshots (optional)</Text>
            <View style={s.screenshotRow}>
              {screenshots.map((shot) => (
                <View key={shot.uri} style={s.screenshotThumbWrap}>
                  <Image source={{ uri: shot.uri }} style={s.screenshotThumb} resizeMode="cover" />
                  <Pressable
                    style={s.screenshotRemove}
                    onPress={() => handleRemoveScreenshot(shot.uri)}
                    hitSlop={8}
                  >
                    <Icon name="x" size={12} color="#FFF" />
                  </Pressable>
                </View>
              ))}
              {screenshots.length < MAX_SCREENSHOTS && (
                <Pressable style={s.screenshotAdd} onPress={handleAddScreenshot}>
                  <Icon name="image" size={18} color={TEXT_MUTED} />
                  <Text style={s.screenshotAddText}>Add</Text>
                </Pressable>
              )}
            </View>

            {error && <Text style={s.errorText}>{error}</Text>}

            <Pressable
              style={[
                s.submitBtn,
                (!message.trim() || submitting) && { opacity: 0.5 },
              ]}
              onPress={handleSubmit}
              disabled={!message.trim() || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Icon name="share" size={16} color="#FFF" />
                  <Text style={s.submitBtnText}>Send Feedback</Text>
                </>
              )}
            </Pressable>
          </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    fontFamily: FONT_HEADING,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
    marginTop: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    fontFamily: FONT_HEADING,
  },
  subtitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    fontFamily: FONT_BODY,
    lineHeight: 18,
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.5)',
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_MUTED,
    fontFamily: FONT_BODY,
  },
  categoryChipTextActive: {
    color: GOLD,
  },
  messageInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT_PRIMARY,
    fontFamily: FONT_BODY,
    minHeight: 120,
  },
  screenshotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  screenshotThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'visible',
  },
  screenshotThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  screenshotRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E05252',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenshotAdd: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  screenshotAddText: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: FONT_BODY,
  },
  errorText: {
    fontSize: 13,
    color: '#E05252',
    fontFamily: FONT_BODY,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
    flex: 1,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
    fontFamily: FONT_BODY,
  },
  confirmIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(72,187,120,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(72,187,120,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    fontFamily: FONT_HEADING,
    textAlign: 'center',
  },
  confirmText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    fontFamily: FONT_BODY,
    lineHeight: 18,
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 8,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    fontFamily: FONT_BODY,
  },
});
