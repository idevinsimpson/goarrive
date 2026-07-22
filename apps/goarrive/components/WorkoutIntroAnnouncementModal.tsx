/**
 * WorkoutIntroAnnouncementModal — coach settings for the spoken workout intro.
 *
 * Opened from the workout three-dots menu. Lets the coach:
 *   - toggle the intro announcement on/off for this workout
 *   - view/edit the spoken script (empty = auto-generated default)
 *   - preview the generated audio
 *
 * Save regenerates the TTS clip when the effective script changed (hash
 * mismatch) and persists introAnnouncement* fields on the workout doc via the
 * parent's onSave.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  Switch,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';
import {
  generateIntroAnnouncementVoice,
  introAnnouncementHash,
  INTRO_ANNOUNCEMENT_MAX_CHARS,
} from '../utils/workoutIntroAnnouncement';

export interface IntroAnnouncementSaveFields {
  introAnnouncementEnabled: boolean;
  introAnnouncementText: string;
  introAnnouncementVoiceUrl?: string;
  introAnnouncementVoiceHash?: string;
}

// ~50ms of silence — used to user-activate the audio element inside the tap
// gesture on iOS Safari before the real TTS URL arrives.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRuQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface Props {
  visible: boolean;
  onClose: () => void;
  workoutId: string;
  /** Auto-generated script shown when the coach hasn't customized the text. */
  defaultScript: string;
  enabled: boolean;
  text: string;
  onSave: (fields: IntroAnnouncementSaveFields) => Promise<void>;
}

export default function WorkoutIntroAnnouncementModal({
  visible,
  onClose,
  workoutId,
  defaultScript,
  enabled,
  text,
  onSave,
}: Props) {
  const [localEnabled, setLocalEnabled] = useState(enabled);
  const [localText, setLocalText] = useState(text);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When iOS blocks autoplay after the TTS wait, we hold the ready URL here
  // and the button becomes "Play preview" — the next tap plays synchronously.
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Re-seed local state each time the modal opens.
  useEffect(() => {
    if (visible) {
      setLocalEnabled(enabled);
      setLocalText(text);
      setError(null);
      setBusy(null);
      setReadyUrl(null);
    }
  }, [visible, enabled, text]);

  const stopPreview = useCallback(() => {
    const el = previewAudioRef.current;
    if (el) {
      try { el.pause(); el.currentTime = 0; } catch { /* best-effort */ }
      previewAudioRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPreview(), [stopPreview]);

  const effectiveText = localText.trim() || defaultScript;

  const handlePreview = useCallback(async () => {
    if (busy) return;
    setError(null);
    stopPreview();
    if (Platform.OS !== 'web') {
      setError('Audio preview is available on web.');
      return;
    }
    // Second tap after iOS blocked autoplay: the URL is ready, play it
    // synchronously inside this gesture — guaranteed to be allowed.
    if (readyUrl) {
      const url = readyUrl;
      setReadyUrl(null);
      try {
        const el = new window.Audio(url);
        previewAudioRef.current = el;
        el.onended = () => { previewAudioRef.current = null; };
        el.play()?.catch?.(() => setError('Could not play the audio preview.'));
      } catch {
        setError('Could not play the audio preview.');
      }
      return;
    }
    setBusy('preview');
    // iOS Safari only allows .play() from inside a user gesture. Prime an
    // element with a tiny silent clip synchronously in this tap so it's
    // user-activated, then swap in the real src once the TTS URL arrives.
    let el: HTMLAudioElement | null = null;
    try {
      el = new window.Audio(SILENT_WAV);
      previewAudioRef.current = el;
      el.play()?.catch?.(() => { /* priming only */ });
    } catch { el = null; }
    const { url } = await generateIntroAnnouncementVoice(workoutId, effectiveText);
    setBusy(null);
    if (!url) {
      stopPreview();
      setError('Could not generate the audio preview. Please try again.');
      return;
    }
    // A newer tap may have replaced the element while we awaited.
    if (el && previewAudioRef.current !== el) return;
    const onBlocked = () => {
      // Autoplay refused — hand the ready clip to the next tap instead.
      previewAudioRef.current = null;
      setReadyUrl(url);
    };
    if (!el) { onBlocked(); return; }
    try {
      el.onended = () => { previewAudioRef.current = null; };
      el.src = url;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(onBlocked);
    } catch {
      onBlocked();
    }
  }, [busy, effectiveText, workoutId, stopPreview, readyUrl]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setError(null);
    stopPreview();
    setBusy('save');
    try {
      const fields: IntroAnnouncementSaveFields = {
        introAnnouncementEnabled: localEnabled,
        introAnnouncementText: localText.trim(),
      };
      if (localEnabled && effectiveText) {
        const { url, hash } = await generateIntroAnnouncementVoice(workoutId, effectiveText);
        if (url) {
          fields.introAnnouncementVoiceUrl = url;
          fields.introAnnouncementVoiceHash = hash;
        }
        // No URL: save text/toggle anyway — the player regenerates lazily.
      }
      await onSave(fields);
      setBusy(null);
      onClose();
    } catch (err: any) {
      setBusy(null);
      setError(err?.message || 'Could not save. Please try again.');
    }
  }, [busy, localEnabled, localText, effectiveText, workoutId, onSave, onClose, stopPreview]);

  const isCustomText = localText.trim().length > 0;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose}>
        {/* Pressable + stopPropagation: on web, taps on inner inputs bubble to
            the backdrop and close the modal; the responder trick doesn't stop
            DOM click bubbling. */}
        <Pressable style={st.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={st.title}>Intro Announcement</Text>
          <Text style={st.subtitle}>
            A spoken welcome plays right after a member taps play — covering the
            focus, muscle groups, and plan for this workout.
          </Text>

          <View style={st.toggleRow}>
            <Text style={st.toggleLabel}>Play intro announcement</Text>
            <Switch
              value={localEnabled}
              onValueChange={setLocalEnabled}
              trackColor={{ false: '#2A3648', true: '#6EBB7A' }}
              thumbColor="#F0F4F8"
            />
          </View>

          {localEnabled && (
            <>
              <View style={st.scriptHeaderRow}>
                <Text style={st.scriptLabel}>
                  {isCustomText ? 'Custom script' : 'Auto-generated script'}
                </Text>
                {isCustomText && (
                  <Pressable onPress={() => setLocalText('')}>
                    <Text style={st.resetLink}>Reset to default</Text>
                  </Pressable>
                )}
              </View>
              <TextInput
                value={isCustomText ? localText : ''}
                onChangeText={(t) => { setLocalText(t); setReadyUrl(null); }}
                onFocus={() => {
                  // Seed the default so the coach edits it instead of retyping.
                  if (!localText.trim()) setLocalText(defaultScript);
                }}
                placeholder={defaultScript}
                placeholderTextColor="#6B7688"
                multiline
                maxLength={INTRO_ANNOUNCEMENT_MAX_CHARS}
                style={st.input}
              />
              <Text style={st.hint}>
                Leave blank to use the auto-generated script (updates as you edit
                the workout). Type to customize what your members hear.
              </Text>

              <Pressable
                style={st.previewBtn}
                onPress={handlePreview}
                disabled={busy !== null}
              >
                {busy === 'preview' ? (
                  <ActivityIndicator size={16} color="#FBBF24" />
                ) : (
                  <Icon name="play" size={16} color="#FBBF24" />
                )}
                <Text style={st.previewBtnText}>
                  {busy === 'preview'
                    ? 'Generating…'
                    : readyUrl
                      ? 'Tap to play preview'
                      : 'Preview audio'}
                </Text>
              </Pressable>
            </>
          )}

          {error && <Text style={st.error}>{error}</Text>}

          <View style={st.actionsRow}>
            <Pressable style={st.cancelBtn} onPress={onClose} disabled={busy === 'save'}>
              <Text style={st.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={st.saveBtn} onPress={handleSave} disabled={busy !== null}>
              {busy === 'save' ? (
                <ActivityIndicator size={16} color="#0E1117" />
              ) : (
                <Text style={st.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#1E2A3A',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    color: '#F0F4F8',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  subtitle: {
    color: '#8A95A3',
    fontSize: 13,
    fontFamily: FB,
    lineHeight: 18,
    marginTop: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  toggleLabel: {
    color: '#F0F4F8',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  scriptHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  scriptLabel: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resetLink: {
    color: '#FBBF24',
    fontSize: 12,
    fontFamily: FB,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3648',
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    lineHeight: 20,
    padding: 12,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  hint: {
    color: '#6B7688',
    fontSize: 11,
    fontFamily: FB,
    lineHeight: 15,
    marginTop: 6,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  previewBtnText: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  error: {
    color: '#EF4444',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  cancelBtn: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  cancelText: {
    color: '#8A95A3',
    fontWeight: '600',
    fontFamily: FB,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#6EBB7A',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveText: {
    color: '#0E1117',
    fontWeight: '700',
    fontFamily: FH,
  },
});
