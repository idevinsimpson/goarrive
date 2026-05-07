/**
 * FollowAlongVideoUploadSheet — pick + crop + upload a long-form follow-along video.
 *
 * Flow: pick (mp4/mov, ≤45 min, ≤1 GB) → 4:5 crop → upload to Firebase Storage →
 *       return payload to parent (WorkoutForm).
 *
 * Sound is ON by default for follow-along videos (coach-led voice in video).
 * The non-destructive crop transform mirrors MovementForm/VideoCropModal pattern.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import VideoCropModal, { CropValues } from './VideoCropModal';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';

// ── Limits (v1) ─────────────────────────────────────────────────────────────
const MAX_DURATION_SEC = 45 * 60; // 45 minutes
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
const ACCEPTED_EXTS = ['mp4', 'mov'];

export interface FollowAlongVideoPayload {
  videoUrl: string;
  videoStoragePath: string;
  videoDurationSec: number;
  soundEnabled: boolean;
  thumbnailUrl?: string;
  cropScale: number;
  cropTranslateX: number;
  cropTranslateY: number;
  cropFrameWidth: number;
  cropFrameHeight: number;
}

// Web-only probe: HTMLVideoElement gives reliable duration + lets us paint a
// frame to a canvas for the library thumbnail. expo-av's onPlaybackStatusUpdate
// reported durationMillis=1 on web, which is why the previous build was
// writing videoDurationSec=1 to Firestore.
async function probeWebVideo(
  uri: string,
): Promise<{ durationSec: number; thumbnailBlob: Blob | null }> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return { durationSec: 0, thumbnailBlob: null };
  }
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let resolved = false;
    const finish = (out: { durationSec: number; thumbnailBlob: Blob | null }) => {
      if (resolved) return;
      resolved = true;
      try {
        video.src = '';
        video.load();
      } catch {
        /* noop */
      }
      resolve(out);
    };

    const captureFrameAndFinish = () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        finish({ durationSec: dur, thumbnailBlob: null });
        return;
      }
      const MAX_W = 720;
      const scale = Math.min(1, MAX_W / vw);
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        finish({ durationSec: dur, thumbnailBlob: null });
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => finish({ durationSec: dur, thumbnailBlob: blob }),
          'image/jpeg',
          0.85,
        );
      } catch {
        finish({ durationSec: dur, thumbnailBlob: null });
      }
    };

    video.onerror = () => finish({ durationSec: 0, thumbnailBlob: null });

    video.onloadedmetadata = () => {
      // Some webm/mp4 streams report duration=Infinity until forced past EOF
      if (!isFinite(video.duration)) {
        video.currentTime = 1e6;
        video.ontimeupdate = () => {
          video.ontimeupdate = null;
          video.onseeked = captureFrameAndFinish;
          const seek = isFinite(video.duration) && video.duration > 0
            ? Math.min(1, Math.max(0, video.duration - 0.05))
            : 0;
          video.currentTime = seek;
        };
        return;
      }
      video.onseeked = captureFrameAndFinish;
      video.currentTime = Math.min(1, Math.max(0, video.duration - 0.05));
    };

    video.src = uri;
    video.load();
  });
}

interface Props {
  visible: boolean;
  coachId: string;
  onClose: () => void;
  onUploaded: (payload: FollowAlongVideoPayload) => void;
}

type Stage = 'pick' | 'crop' | 'uploading';

function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

function extOf(uri: string): string {
  const m = uri.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return (m?.[1] ?? '').toLowerCase();
}

function fmtMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function FollowAlongVideoUploadSheet({
  visible,
  coachId,
  onClose,
  onUploaded,
}: Props) {
  const [stage, setStage] = useState<Stage>('pick');
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedSize, setPickedSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  const probeVideoRef = useRef<Video | null>(null);

  // Reset state every time the sheet opens
  useEffect(() => {
    if (visible) {
      setStage('pick');
      setPickedUri(null);
      setPickedSize(null);
      setDuration(null);
      setSoundEnabled(true);
      setProgress(0);
      setBusy(false);
    }
  }, [visible]);

  // ── Probe duration (web + native via expo-av onLoad) ───────────────────
  const onProbeStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    const ms = status.durationMillis;
    if (ms != null && duration == null) {
      setDuration(ms / 1000);
    }
  }, [duration]);

  // ── Pick handler ───────────────────────────────────────────────────────
  const pick = useCallback(async () => {
    try {
      setBusy(true);
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission Required', 'Please grant media library access to upload videos.');
        setBusy(false);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      const ext = extOf(asset.fileName ?? asset.uri);
      if (ext && !ACCEPTED_EXTS.includes(ext)) {
        showAlert('Unsupported Format', 'Please upload an .mp4 or .mov file.');
        setBusy(false);
        return;
      }

      // Size check (asset.fileSize on iOS, otherwise fetch HEAD via blob)
      let size = asset.fileSize ?? null;
      if (size == null) {
        try {
          const head = await fetch(asset.uri);
          const b = await head.blob();
          size = b.size;
        } catch {
          size = null;
        }
      }
      if (size != null && size > MAX_BYTES) {
        showAlert('File Too Large', 'Follow-along videos must be 1 GB or smaller.');
        setBusy(false);
        return;
      }

      // Duration check (prefer asset.duration ms; else expo-av probe via state)
      const d = asset.duration != null ? asset.duration / 1000 : null;
      if (d != null && d > MAX_DURATION_SEC) {
        showAlert('Video Too Long', 'Follow-along videos must be 45 minutes or shorter.');
        setBusy(false);
        return;
      }

      setPickedUri(asset.uri);
      setPickedSize(size);
      setDuration(d);
      setStage('crop');
      setBusy(false);
    } catch (err) {
      console.error('[FollowAlongVideoUploadSheet] pick error:', err);
      setBusy(false);
    }
  }, []);

  // ── Crop done → upload ─────────────────────────────────────────────────
  const onCropDone = useCallback(async (crop: CropValues) => {
    if (!pickedUri) return;

    setStage('uploading');
    setProgress(0);

    try {
      // Authoritative duration + thumbnail capture.
      // On web, HTMLVideoElement gives a reliable duration where expo-av did not.
      let finalDuration = duration ?? 0;
      let thumbnailBlob: Blob | null = null;
      if (Platform.OS === 'web') {
        const probe = await probeWebVideo(pickedUri);
        if (probe.durationSec > 0) finalDuration = probe.durationSec;
        thumbnailBlob = probe.thumbnailBlob;
      }

      if (finalDuration > MAX_DURATION_SEC) {
        showAlert('Video Too Long', 'Follow-along videos must be 45 minutes or shorter.');
        setStage('pick');
        return;
      }
      if (finalDuration <= 0) {
        showAlert('Could Not Read Duration', 'Please try a different video file.');
        setStage('pick');
        return;
      }

      const response = await fetch(pickedUri);
      const blob = await response.blob();
      if (blob.size > MAX_BYTES) {
        showAlert('File Too Large', 'Follow-along videos must be 1 GB or smaller.');
        setStage('pick');
        return;
      }

      const ext = (extOf(pickedUri) || 'mp4') as 'mp4' | 'mov';
      const tsBase = Date.now();
      const path = `workouts/${coachId}/follow-along-videos/${tsBase}.${ext}`;
      const storageRef = ref(storage, path);
      const task = uploadBytesResumable(storageRef, blob, {
        contentType: ext === 'mov' ? 'video/quicktime' : 'video/mp4',
      });

      await new Promise<void>((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const p = snap.totalBytes > 0 ? snap.bytesTransferred / snap.totalBytes : 0;
            setProgress(p);
          },
          (err) => reject(err),
          () => resolve(),
        );
      });

      const downloadUrl = await getDownloadURL(task.snapshot.ref);

      // Best-effort poster upload — failure is non-fatal (video still works).
      let thumbnailUrl: string | undefined;
      if (thumbnailBlob) {
        try {
          const posterPath = `workouts/${coachId}/follow-along-videos/${tsBase}-poster.jpg`;
          const posterRef = ref(storage, posterPath);
          await uploadBytes(posterRef, thumbnailBlob, { contentType: 'image/jpeg' });
          thumbnailUrl = await getDownloadURL(posterRef);
        } catch (posterErr) {
          console.warn('[FollowAlongVideoUploadSheet] poster upload failed:', posterErr);
        }
      }

      onUploaded({
        videoUrl: downloadUrl,
        videoStoragePath: path,
        videoDurationSec: Math.round(finalDuration),
        soundEnabled,
        thumbnailUrl,
        cropScale: crop.cropScale,
        cropTranslateX: crop.cropTranslateX,
        cropTranslateY: crop.cropTranslateY,
        cropFrameWidth: crop.cropFrameWidth,
        cropFrameHeight: crop.cropFrameHeight,
      });
      onClose();
    } catch (err) {
      console.error('[FollowAlongVideoUploadSheet] upload error:', err);
      showAlert('Upload Failed', 'Please check your connection and try again.');
      setStage('crop');
    }
  }, [pickedUri, duration, coachId, soundEnabled, onUploaded, onClose]);

  const onCropCancel = useCallback(() => {
    setStage('pick');
    setPickedUri(null);
    setDuration(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <Modal visible={visible && stage !== 'crop'} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>Follow-Along Video</Text>
              <Pressable onPress={onClose} hitSlop={10} disabled={busy}>
                <Icon name="close" size={20} color="#8A95A3" />
              </Pressable>
            </View>

            {stage === 'pick' && (
              <View style={styles.body}>
                <Text style={styles.subtitle}>
                  Upload a long-form video (warm-up, stretch, mobility, etc.). The workout
                  timer will follow the video's duration.
                </Text>
                <View style={styles.limitsRow}>
                  <Text style={styles.limitText}>Max 45 min · 1 GB · .mp4 or .mov</Text>
                </View>

                {/* Sound toggle */}
                <Pressable
                  style={styles.soundRow}
                  onPress={() => setSoundEnabled((v) => !v)}
                >
                  <Icon
                    name={soundEnabled ? 'volume-high' : 'volume-mute'}
                    size={18}
                    color={soundEnabled ? '#34D399' : '#8A95A3'}
                  />
                  <Text style={styles.soundLabel}>
                    Sound {soundEnabled ? 'on' : 'off'} during playback
                  </Text>
                  <View style={[styles.toggle, soundEnabled && styles.toggleOn]}>
                    <View style={[styles.toggleDot, soundEnabled && styles.toggleDotOn]} />
                  </View>
                </Pressable>
                <Text style={styles.hint}>
                  Default on so the coach's voice plays through. Toggle off to mute.
                </Text>

                <Pressable
                  style={[styles.primaryBtn, busy && styles.btnDisabled]}
                  onPress={pick}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#0E1117" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Choose Video</Text>
                  )}
                </Pressable>
              </View>
            )}

            {stage === 'uploading' && (
              <View style={styles.body}>
                <ActivityIndicator size="large" color="#F5A623" />
                <Text style={styles.uploadingTitle}>
                  Uploading… {Math.round(progress * 100)}%
                </Text>
                {duration != null && (
                  <Text style={styles.uploadingMeta}>
                    {fmtMmSs(duration)} · {pickedSize ? `${(pickedSize / (1024 * 1024)).toFixed(1)} MB` : ''}
                  </Text>
                )}
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.hint}>Keep this screen open until the upload finishes.</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Hidden probe video to read duration when the picker doesn't return it */}
      {pickedUri && duration == null && (
        <Video
          ref={probeVideoRef}
          source={{ uri: pickedUri }}
          style={styles.hiddenProbe}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={onProbeStatus}
          shouldPlay={false}
          isMuted
        />
      )}

      {/* Crop modal */}
      {pickedUri && (
        <VideoCropModal
          visible={stage === 'crop'}
          videoUri={pickedUri}
          frameAspect={4 / 5}
          onDone={onCropDone}
          onCancel={onCropCancel}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  title: {
    color: '#F0F4F8',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FH,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  subtitle: {
    color: '#C5CCD6',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FB,
  },
  limitsRow: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  limitText: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0E1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  soundLabel: {
    flex: 1,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1E2A3A',
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: '#34D399',
  },
  toggleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8A95A3',
  },
  toggleDotOn: {
    backgroundColor: '#0E1117',
    transform: [{ translateX: 16 }],
  },
  hint: {
    color: '#8A95A3',
    fontSize: 11,
    fontFamily: FB,
    lineHeight: 16,
  },
  primaryBtn: {
    backgroundColor: '#F5A623',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#0E1117',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  uploadingTitle: {
    color: '#F0F4F8',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
    marginTop: 6,
  },
  uploadingMeta: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
    textAlign: 'center',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#1E2A3A',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
  },
  hiddenProbe: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
