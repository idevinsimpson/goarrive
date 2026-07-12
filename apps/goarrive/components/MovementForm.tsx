/**
 * MovementForm — Radically Simplified Movement Creation
 *
 * NEW CREATE FLOW (crop-first, AI auto-fill):
 *   Step 1 (upload):  Clean 4:5 frame with a big "+" — coach uploads/records
 *   Step 2 (crop):    VideoCropModal for reframing within 4:5
 *   Step 3 (process): Video loops while GIF + AI + voice generate silently
 *                      → auto-saves → modal closes
 *
 * EDIT MODE:
 *   When editMovement is provided, shows the full metadata form (all fields
 *   pre-filled by AI) so the coach can tweak anything.
 *
 * Props:
 *   - visible: boolean
 *   - onClose: () => void
 *   - coachId: string
 *   - tenantId: string
 *   - editMovement?: MovementDetailData | null
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  Image,
  Linking,
} from 'react-native';
import ModalSheet from './ModalSheet';
import { db, storage } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { Icon } from './Icon';
import MovementVideoControls from './MovementVideoControls';
import VideoCropModal, { CropValues } from './VideoCropModal';
import { MovementDetailData } from './MovementDetail';
import { encodeOneRepLoopGif, CropTransform } from '../utils/generateMovementDerivatives';
import {
  createMovementFromVideo,
  uploadMovementBlob,
  generateAndUploadMovementDerivatives,
  MovementDerivativeUrls,
} from '../utils/createMovementFromVideo';
import { generateMovementVoice } from '../utils/generateMovementVoice';
import { analyzeMovementMedia, MovementAnalysis } from '../utils/analyzeMovementMedia';
import { analyzeMovementReps } from '../utils/analyzeMovementReps';
import { isImageUrl, imageExtFromMime, generateImageThumbnailBlob } from '../utils/mediaKind';
import { reconcileMuscleFields } from '../utils/muscleClassification';
import { FB, FH } from '../lib/theme';

// ── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = [
  'Upper Body Push',
  'Upper Body Pull',
  'Lower Body Push',
  'Lower Body Pull',
  'Core',
  'Cardio',
  'Mobility',
];

const EQUIPMENT_OPTIONS = [
  'Bodyweight',
  'Dumbbell',
  'Barbell',
  'Kettlebell',
  'Band',
  'Cable',
  'Machine',
];

const DIFFICULTY_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'];

// Title-case the first letter of each whitespace-separated word.
// Length-preserving so the cursor stays put while typing. Only promotes
// lowercase letters at word starts — never demotes user-typed uppercase
// (e.g. "iPhone", "BarBell"), so it doesn't fight intentional casing.
function toTitleCase(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

const MUSCLE_GROUP_OPTIONS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full Body',
];

// Phase 4: normalize a movement name for duplicate matching.
// Case-insensitive, trim outer whitespace, collapse internal whitespace
// runs to a single space. "  Air   squat " ≈ "air squat".
function normalizeMovementName(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Propagate swap field changes from the movement library into every workout
// block that references this movement.  Fire-and-forget — never blocks the UI.
async function propagateSwapToWorkouts(
  movementId: string,
  coachId: string,
  swap: { swapSides: boolean; swapMode: 'split' | 'duplicate'; swapWindowSec: number },
) {
  try {
    const wq = query(collection(db, 'workouts'), where('coachId', '==', coachId));
    const snap = await getDocs(wq);
    const writes: Promise<void>[] = [];
    snap.forEach((wdoc) => {
      const data = wdoc.data();
      const blocks = data.blocks;
      if (!Array.isArray(blocks)) return;
      let changed = false;
      const newBlocks = blocks.map((b: any) => {
        if (!b || !Array.isArray(b.movements)) return b;
        let blockChanged = false;
        const newMovs = b.movements.map((m: any) => {
          if (m && m.movementId === movementId) {
            if (
              m.swapSides !== swap.swapSides ||
              m.swapMode !== swap.swapMode ||
              m.swapWindowSec !== swap.swapWindowSec
            ) {
              blockChanged = true;
              return { ...m, swapSides: swap.swapSides, swapMode: swap.swapMode, swapWindowSec: swap.swapWindowSec };
            }
          }
          return m;
        });
        if (blockChanged) { changed = true; return { ...b, movements: newMovs }; }
        return b;
      });
      if (changed) {
        writes.push(updateDoc(doc(db, 'workouts', wdoc.id), { blocks: newBlocks, updatedAt: serverTimestamp() }));
      }
    });
    await Promise.all(writes);
    console.log(`[MovementForm] Propagated swap to ${writes.length} workouts`);
  } catch (err) {
    console.warn('[MovementForm] Swap propagation failed:', err);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface MovementFormProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  tenantId: string;
  editMovement?: MovementDetailData | null;
  // Phase 4: optional in-memory list used to avoid a Firestore round-trip
  // when checking for duplicate names. If omitted or empty, the dup check
  // falls back to a one-shot getDocs query scoped to coachId.
  existingMovements?: Array<{ id: string; name: string }>;
}

type CreateStep = 'upload' | 'crop' | 'processing' | 'no-video-meta';

// ── Component ──────────────────────────────────────────────────────────────
export default function MovementForm({
  visible,
  onClose,
  coachId,
  tenantId,
  editMovement,
  existingMovements,
}: MovementFormProps) {
  const isEdit = !!editMovement;

  // ── Camera permission pre-check ────────────────────────────────────────
  const [cameraPermStatus, setCameraPermStatus] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');

  useEffect(() => {
    if (visible && Platform.OS !== 'web') {
      ImagePicker.getCameraPermissionsAsync().then(({ status }) => {
        setCameraPermStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
      });
    }
  }, [visible]);

  // ── Create-flow step state ─────────────────────────────────────────────
  const [createStep, setCreateStep] = useState<CreateStep>('upload');
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [equipment, setEquipment] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [description, setDescription] = useState('');
  const [muscleGroups, setMuscleGroups] = useState<string[]>([]);
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>([]);
  const [secondaryMuscles, setSecondaryMuscles] = useState<string[]>([]);
  const [workSec, setWorkSec] = useState('30');
  const [restSec, setRestSec] = useState('15');
  const [countdownSec, setCountdownSec] = useState('3');
  const [swapSides, setSwapSides] = useState(false);
  const [swapMode, setSwapMode] = useState<'split' | 'duplicate'>('split');
  const [swapWindowSec, setSwapWindowSec] = useState(5);
  const [videoUrl, setVideoUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [regression, setRegression] = useState('');
  const [progression, setProgression] = useState('');
  const [contraindications, setContraindications] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Auto-save state (edit mode) ───────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Tracks the last name we've already regenerated voice for. Initialized to
  // editMovement.name when the form opens so a no-op rename doesn't trigger
  // regeneration. Updated each time we kick off a new generateMovementVoice.
  const lastVoiceNameRef = useRef<string>('');

  // ── GIF thumbnail generation state ────────────────────────────────────
  const [generatingGif, setGeneratingGif] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const gifPromiseRef = useRef<Promise<string | null> | null>(null);
  const savedDocIdRef = useRef<string | null>(null);

  // ── Crop/reframe state ─────────────────────────────────────────────────
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropScale, setCropScale] = useState(1);
  const [cropTranslateX, setCropTranslateX] = useState(0);
  const [cropFrameWidth, setCropFrameWidth] = useState(345);
  const [cropFrameHeight, setCropFrameHeight] = useState(431);
  const [cropTranslateY, setCropTranslateY] = useState(0);

  // ── Phase 3: add-video-later flow (edit mode) ──────────────────────────
  // Set true when the coach taps Add Video on a placeholder movement.
  // Drives processAfterCrop to run the full derivatives + AI pipeline
  // (and updateDoc, not addDoc) instead of the legacy GIF-only reframe path.
  const addVideoSessionRef = useRef<boolean>(false);
  const [editProcessing, setEditProcessing] = useState(false);
  const [editProcessingStatus, setEditProcessingStatus] = useState('Analyzing video…');
  const [aiMergeData, setAiMergeData] = useState<{
    proposed: MovementAnalysis;
    existing: {
      name: string;
      category: string;
      equipment: string;
      difficulty: string;
      description: string;
      muscleGroups: string[];
      workSec: number;
      restSec: number;
      regression: string;
      progression: string;
      contraindications: string;
    };
    derivatives: {
      videoUrl: string;
      thumbnailUrl: string;
      thumbnailImageUrl: string;
      posterUrl: string;
      gifLowUrl: string;
      gifHighUrl: string | null;
      cropScale: number;
      cropTranslateX: number;
      cropTranslateY: number;
      cropFrameWidth: number;
      cropFrameHeight: number;
      _loFrames: ImageData[];
    };
  } | null>(null);
  const [aiMergeChecked, setAiMergeChecked] = useState<Record<string, boolean>>({});

  // ── Phase 4: duplicate-name soft warning ───────────────────────────────
  // Soft warning only — never blocks save. Two surfaces:
  //   1. The no-video create flow (taps Save on the no-video metadata form)
  //   2. The AI confirm-merge modal (proposed AI name matches another movement)
  const [noVideoDupWarning, setNoVideoDupWarning] = useState<
    { id: string; name: string } | null
  >(null);
  const [aiMergeDupWarning, setAiMergeDupWarning] = useState<
    { id: string; name: string } | null
  >(null);
  const [aiMergeDupDismissed, setAiMergeDupDismissed] = useState(false);
  // Refs for focusing the name input when the coach taps "Rename".
  const noVideoNameInputRef = useRef<TextInput | null>(null);
  const editNameInputRef = useRef<TextInput | null>(null);

  // Phase 4: find a duplicate movement by name. Prefers the in-memory list
  // (existingMovements prop) when available; falls back to a one-shot
  // getDocs query scoped to this coach. Excludes the movement currently
  // being edited so the coach doesn't get warned about themselves.
  const findDuplicateMovement = useCallback(
    async (
      proposedName: string,
    ): Promise<{ id: string; name: string } | null> => {
      const target = normalizeMovementName(proposedName);
      if (!target) return null;
      const selfId = editMovement?.id ?? null;

      if (existingMovements && existingMovements.length > 0) {
        for (const m of existingMovements) {
          if (selfId && m.id === selfId) continue;
          if (normalizeMovementName(m.name) === target) {
            return { id: m.id, name: m.name };
          }
        }
        return null;
      }

      if (!coachId) return null;
      try {
        const snap = await getDocs(
          query(collection(db, 'movements'), where('coachId', '==', coachId)),
        );
        for (const d of snap.docs) {
          if (selfId && d.id === selfId) continue;
          const docName = (d.data() as any).name || '';
          if (normalizeMovementName(docName) === target) {
            return { id: d.id, name: docName };
          }
        }
      } catch (err) {
        // Soft warning is purely advisory — never block on the check.
        console.warn('[MovementForm] Duplicate-name check failed:', err);
      }
      return null;
    },
    [existingMovements, editMovement, coachId],
  );

  // ── Pre-populate on edit ───────────────────────────────────────────────
  useEffect(() => {
    if (editMovement) {
      lastVoiceNameRef.current = (editMovement.name || '').trim();
      setName(editMovement.name || '');
      setCategory(editMovement.category || '');
      setEquipment(editMovement.equipment || '');
      setDifficulty(editMovement.difficulty || '');
      setDescription(editMovement.description || '');
      setMuscleGroups(editMovement.muscleGroups || []);
      setPrimaryMuscles((editMovement as any).primaryMuscles || []);
      setSecondaryMuscles((editMovement as any).secondaryMuscles || []);
      setWorkSec(String(editMovement.workSec ?? 30));
      setRestSec(String(editMovement.restSec ?? 15));
      setCountdownSec(String(editMovement.countdownSec ?? 3));
      setSwapSides(editMovement.swapSides ?? false);
      setSwapMode(((editMovement as any).swapMode === 'duplicate' ? 'duplicate' : 'split'));
      setSwapWindowSec(Math.max(0, Math.min(15, (editMovement as any).swapWindowSec ?? 5)));
      setVideoUrl((editMovement as any).videoUrl || editMovement.mediaUrl || '');
      setThumbnailUrl((editMovement as any).thumbnailUrl || '');
      setRegression((editMovement as any).regression || '');
      setProgression((editMovement as any).progression || '');
      setContraindications((editMovement as any).contraindications || '');
      setCropScale((editMovement as any).cropScale ?? 1);
      setCropTranslateX((editMovement as any).cropTranslateX ?? 0);
      setCropTranslateY((editMovement as any).cropTranslateY ?? 0);
      setCropFrameWidth((editMovement as any).cropFrameWidth ?? 345);
      setCropFrameHeight((editMovement as any).cropFrameHeight ?? 431);
    } else {
      resetForm();
    }
  }, [editMovement, visible]);

  const resetForm = () => {
    setCreateStep('upload');
    setProcessingStatus('');
    setProcessingProgress(0);
    setName('');
    setCategory('');
    setEquipment('');
    setDifficulty('');
    setDescription('');
    setMuscleGroups([]);
    setPrimaryMuscles([]);
    setSecondaryMuscles([]);
    setWorkSec('30');
    setRestSec('15');
    setCountdownSec('3');
    setSwapSides(false);
    setVideoUrl('');
    setThumbnailUrl('');
    setUploading(false);
    setUploadProgress(0);
    setRegression('');
    setProgression('');
    setContraindications('');
    setCropScale(1);
    setCropTranslateX(0);
    setCropTranslateY(0);
    setCropFrameWidth(345);
    setCropFrameHeight(431);
    setShowCropModal(false);
    setGeneratingGif(false);
    setGifProgress(0);
    gifPromiseRef.current = null;
    savedDocIdRef.current = null;
  };

  // ── No-video creation ──────────────────────────────────────────────
  const startNoVideoCreate = () => {
    setVideoUrl('');
    setCropScale(1);
    setCropTranslateX(0);
    setCropTranslateY(0);
    setCropFrameWidth(0);
    setCropFrameHeight(0);
    setNoVideoDupWarning(null);
    setCreateStep('no-video-meta');
  };

  // Phase 4: Save tap in the no-video-create flow. First tap runs the
  // duplicate-name check; if a match is found, show a soft warning banner
  // and stop. Second tap (or the banner's Save anyway) proceeds without
  // re-checking, so the coach never sees the warning twice for the same
  // pending save.
  const handleNoVideoSavePressed = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a movement name.');
      return;
    }
    if (noVideoDupWarning) {
      setNoVideoDupWarning(null);
      await saveNoVideoMovement();
      return;
    }
    const match = await findDuplicateMovement(name);
    if (match) {
      setNoVideoDupWarning(match);
      return;
    }
    await saveNoVideoMovement();
  };

  // Clear the dup warning whenever the coach edits the name. The next Save
  // tap will re-check against the updated name. (Keeps the banner from
  // pointing at a stale match while the coach is mid-rename.)
  useEffect(() => {
    if (noVideoDupWarning) setNoVideoDupWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const saveNoVideoMovement = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a movement name.');
      return;
    }
    setSubmitting(true);
    try {
      // The no-video-meta form is shared by two flows: create-without-media
      // (videoUrl empty) and photo create (videoUrl holds an uploaded image).
      const isImageCreate = !!videoUrl.trim() && isImageUrl(videoUrl);
      const data: Record<string, any> = {
        name: name.trim(),
        category,
        equipment,
        difficulty,
        description: description.trim(),
        ...reconcileMuscleFields(muscleGroups, primaryMuscles, secondaryMuscles),
        workSec: parseInt(workSec, 10) || 30,
        restSec: parseInt(restSec, 10) || 15,
        countdownSec: parseInt(countdownSec, 10) || 3,
        swapSides,
        swapMode,
        swapWindowSec,
        videoUrl: isImageCreate ? videoUrl.trim() : '',
        ...(isImageCreate
          ? { mediaType: 'image', posterUrl: thumbnailUrl || '' }
          : {}),
        thumbnailUrl: isImageCreate ? thumbnailUrl || '' : '',
        thumbnailImageUrl: isImageCreate ? thumbnailUrl || '' : '',
        gifLowUrl: '',
        gifLoopUrl: '',
        cropScale: 1,
        cropTranslateX: 0,
        cropTranslateY: 0,
        cropFrameWidth: 0,
        cropFrameHeight: 0,
        regression: regression.trim(),
        progression: progression.trim(),
        contraindications: contraindications.trim(),
        coachId,
        tenantId,
        isGlobal: false,
        isArchived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'movements'), data);
      const docId = docRef.id;

      generateMovementVoice(docId, name.trim())
        .then(({ url, text, voiceName }) => {
          const update: Record<string, any> = url
            ? { voiceUrl: url, voiceText: text, voiceName }
            : { voiceUrl: '', voiceText: '', voiceName: '' };
          updateDoc(doc(db, 'movements', docId), update).catch(() => {});
        })
        .catch(() => {});

      resetForm();
      onClose();
    } catch (err) {
      console.error('[MovementForm] No-video save error:', err);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── GIF thumbnail generation ─────────────────────────────────────────
  /**
   * Upload a blob to Firebase Storage and return its download URL.
   */
  const uploadBlob = useCallback(
    (blob: Blob, subfolder: string, ext: string): Promise<string> =>
      uploadMovementBlob(coachId, blob, subfolder, ext),
    [coachId],
  );

  /**
   * Generate all derivatives and upload them. Returns URLs for each asset.
   * Delegates to the shared pipeline (utils/createMovementFromVideo) and
   * layers on component UI state + saved-doc auto-patching.
   */
  const generateAndUploadDerivatives = useCallback(
    (url: string, crop: CropTransform): Promise<MovementDerivativeUrls> => {
      if (Platform.OS !== 'web' || !url) {
        return Promise.resolve({ gifHighUrl: null, gifLowUrl: null, thumbnailImageUrl: null, posterUrl: null, _loFrames: [] });
      }

      setGeneratingGif(true);
      setGifProgress(0);

      const promise = (async () => {
        const result = await generateAndUploadMovementDerivatives(url, crop, coachId, (p) => {
          setGifProgress(p);
        });
        const { gifHighUrl, gifLowUrl, posterUrl } = result;

        setThumbnailUrl(gifHighUrl || posterUrl || '');
        setGeneratingGif(false);
        setGifProgress(0);

        // Auto-patch if doc was already saved. Only write fields the pipeline
        // actually produced (legacy fallback returns gifHighUrl only — don't
        // blank an existing poster/low-GIF in that case).
        if (savedDocIdRef.current && (gifHighUrl || posterUrl)) {
          const patch: Record<string, any> = { thumbnailUrl: gifHighUrl || posterUrl || '' };
          if (gifLowUrl) patch.gifLowUrl = gifLowUrl;
          if (posterUrl) {
            patch.thumbnailImageUrl = posterUrl;
            patch.posterUrl = posterUrl;
          }
          updateDoc(doc(db, 'movements', savedDocIdRef.current), patch)
            .catch((err) => console.error('[MovementForm] Auto-patch derivatives error:', err));
        }

        return result;
      })();

      gifPromiseRef.current = promise.then((r) => r.gifHighUrl || r.thumbnailImageUrl);
      return promise;
    },
    [coachId],
  );

  /** Legacy wrapper for edit-mode GIF regeneration (backwards compat). */
  const generateAndUploadGif = useCallback(
    (url: string, crop: CropValues): Promise<string | null> => {
      const fullCrop: CropTransform = {
        ...crop,
        cropFrameWidth: (crop as any).cropFrameWidth ?? cropFrameWidth,
        cropFrameHeight: (crop as any).cropFrameHeight ?? cropFrameHeight,
      };
      return generateAndUploadDerivatives(url, fullCrop).then((r) => r.gifHighUrl);
    },
    [generateAndUploadDerivatives, cropFrameWidth, cropFrameHeight],
  );

  // ── Media upload (shared by Library and Camera) ──────────────────────
  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const isVideo = asset.type === 'video';
    const ext = isVideo ? 'mp4' : imageExtFromMime(asset.mimeType);
    const folder = isVideo ? 'videos' : 'images';
    const fileName = `movements/${coachId}/${folder}/${Date.now()}.${ext}`;

    setUploading(true);
    setUploadProgress(0);

    const response = await fetch(asset.uri);
    const blob = await response.blob();

    const storageRef = ref(storage, fileName);
    const uploadTask = uploadBytesResumable(storageRef, blob, {
      contentType: isVideo ? 'video/mp4' : asset.mimeType || 'image/jpeg',
    });

    return new Promise<string>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.bytesTransferred / snapshot.totalBytes;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('[MovementForm] Upload error:', error);
          setUploading(false);
          setUploadProgress(0);
          reject(error);
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          setUploading(false);
          setUploadProgress(0);
          resolve(downloadUrl);
        },
      );
    });
  };

  // ── Image path — photos skip the crop/GIF/AI-video pipeline ─────────
  // Upload the photo, cover-crop a 240×300 JPEG thumbnail (web), then:
  //   create mode → open the metadata form so the coach names it
  //   edit mode (add-media CTA) → patch the movement doc directly
  const handlePickedImage = async (asset: ImagePicker.ImagePickerAsset) => {
    const isAddMediaSession = isEdit && !!editMovement && addVideoSessionRef.current;

    const imageUrl = await uploadAsset(asset);

    let thumbUrl = imageUrl;
    try {
      const blob = await generateImageThumbnailBlob(imageUrl);
      if (blob) thumbUrl = await uploadBlob(blob, 'thumbnails', 'jpg');
    } catch (err) {
      console.warn('[MovementForm] Image thumbnail failed, using original:', err);
    }

    setVideoUrl(imageUrl);
    setThumbnailUrl(thumbUrl);
    setCropScale(1);
    setCropTranslateX(0);
    setCropTranslateY(0);

    if (isAddMediaSession && editMovement) {
      addVideoSessionRef.current = false;
      await updateDoc(doc(db, 'movements', editMovement.id), {
        videoUrl: imageUrl,
        mediaType: 'image',
        thumbnailUrl: thumbUrl,
        thumbnailImageUrl: thumbUrl,
        posterUrl: thumbUrl,
        gifLowUrl: '',
        gifLoopUrl: '',
        cropScale: 1,
        cropTranslateX: 0,
        cropTranslateY: 0,
        cropFrameWidth: 0,
        cropFrameHeight: 0,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    // Create mode: reuse the metadata form step (no AI analysis for photos)
    setCreateStep('no-video-meta');
  };

  // ── Pick from library ────────────────────────────────────────────────
  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant media library access to upload videos or photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 25,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];

      if (asset.type !== 'video') {
        await handlePickedImage(asset);
        return;
      }

      const downloadUrl = await uploadAsset(asset);
      setVideoUrl(downloadUrl);

      // Go to crop step
      setCropScale(1);
      setCropTranslateX(0);
      setCropTranslateY(0);
      setCreateStep('crop');
      setTimeout(() => setShowCropModal(true), 300);
    } catch (err) {
      console.error('[MovementForm] Pick media error:', err);
      setUploading(false);
    }
  };

  // ── Record from camera ───────────────────────────────────────────────
  const recordFromCamera = async () => {
    try {
      if (cameraPermStatus === 'denied') {
        Alert.alert(
          'Camera Access Denied',
          'You previously denied camera access. To record movement videos, please enable camera permissions in your device Settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      setCameraPermStatus(status === 'granted' ? 'granted' : 'denied');
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant camera access to record videos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 25,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const downloadUrl = await uploadAsset(result.assets[0]);
      setVideoUrl(downloadUrl);

      // Go to crop step
      setCropScale(1);
      setCropTranslateX(0);
      setCropTranslateY(0);
      setCreateStep('crop');
      setTimeout(() => setShowCropModal(true), 300);
    } catch (err) {
      console.error('[MovementForm] Camera record error:', err);
      setUploading(false);
    }
  };

  // ── Process after crop (the magic pipeline) ──────────────────────────
  const processAfterCrop = async (crop: CropValues) => {
    setCropScale(crop.cropScale);
    setCropTranslateX(crop.cropTranslateX);
    setCropTranslateY(crop.cropTranslateY);
    setCropFrameWidth(crop.cropFrameWidth);
    setCropFrameHeight(crop.cropFrameHeight);
    setShowCropModal(false);
    const isAddVideoSession = isEdit && !!editMovement && addVideoSessionRef.current;
    if (isAddVideoSession) {
      setEditProcessing(true);
      setEditProcessingStatus('Creating thumbnails…');
    } else {
      setCreateStep('processing');
    }

    const fullCrop: CropTransform = {
      cropScale: crop.cropScale,
      cropTranslateX: crop.cropTranslateX,
      cropTranslateY: crop.cropTranslateY,
      cropFrameWidth: crop.cropFrameWidth,
      cropFrameHeight: crop.cropFrameHeight,
    };

    try {
      // Create flow: run the shared end-to-end pipeline (derivatives, AI
      // analysis, doc creation, voice, one-rep loop) — single source of
      // truth shared with the AI variation flow.
      if (!isAddVideoSession) {
        const { movementId } = await createMovementFromVideo({
          videoUrl,
          crop: fullCrop,
          coachId,
          tenantId,
          onStatus: setProcessingStatus,
          onProgress: setProcessingProgress,
        });
        savedDocIdRef.current = movementId;

        // Brief pause to show completion, then close
        setTimeout(() => {
          resetForm();
          onClose();
        }, 600);
        return;
      }

      // Edit-mode add-video flow: generate derivatives + AI proposal, then
      // open the confirm-merge modal (never auto-overwrite metadata).
      setProcessingStatus('Creating thumbnails...');
      setProcessingProgress(0.1);

      const derivatives = await generateAndUploadDerivatives(videoUrl, fullCrop);
      const { gifHighUrl, gifLowUrl, thumbnailImageUrl, posterUrl: derivedPosterUrl, _loFrames } = derivatives;

      setProcessingProgress(0.4);
      if (isAddVideoSession) setEditProcessingStatus('Analyzing video…');

      // Step 2: AI Analysis (runs on the high-quality GIF)
      let aiData: Record<string, any> = {};
      let aiAnalysis: MovementAnalysis | null = null;
      if (gifHighUrl) {
        setProcessingStatus('Analyzing movement...');
        setProcessingProgress(0.5);
        try {
          aiAnalysis = await analyzeMovementMedia(videoUrl, fullCrop);
          if (aiAnalysis) {
            aiData = {
              name: aiAnalysis.name || '',
              category: aiAnalysis.category || '',
              equipment: aiAnalysis.equipment || '',
              difficulty: aiAnalysis.difficulty || '',
              muscleGroups: aiAnalysis.muscleGroups || [],
              description: aiAnalysis.description || '',
              regression: aiAnalysis.regression || '',
              progression: aiAnalysis.progression || '',
              contraindications: aiAnalysis.contraindications || '',
              workSec: aiAnalysis.workSec || 30,
              restSec: aiAnalysis.restSec || 15,
            };
          }
        } catch (aiErr) {
          console.warn('[MovementForm] AI analysis failed, saving without:', aiErr);
        }
      }

      // Edit-mode add-video flow: do NOT auto-overwrite metadata.
      // Open the AI confirm-merge modal with side-by-side proposals.
      if (isAddVideoSession && editMovement) {
        addVideoSessionRef.current = false;
        setEditProcessing(false);
        const proposed: MovementAnalysis = aiAnalysis ?? {
          name: '',
          category: '',
          equipment: '',
          difficulty: '',
          primaryMuscles: [],
          secondaryMuscles: [],
          muscleGroups: [],
          description: '',
          regression: '',
          progression: '',
          contraindications: '',
          workSec: 30,
          restSec: 15,
          confidence: 0,
        };
        setAiMergeData({
          proposed,
          existing: {
            name,
            category,
            equipment,
            difficulty,
            description,
            muscleGroups,
            workSec: parseInt(workSec, 10) || 30,
            restSec: parseInt(restSec, 10) || 15,
            regression,
            progression,
            contraindications,
          },
          derivatives: {
            videoUrl: videoUrl.trim(),
            thumbnailUrl: gifHighUrl || derivedPosterUrl || '',
            thumbnailImageUrl: derivedPosterUrl || '',
            posterUrl: derivedPosterUrl || '',
            gifLowUrl: gifLowUrl || '',
            gifHighUrl,
            cropScale: crop.cropScale,
            cropTranslateX: crop.cropTranslateX,
            cropTranslateY: crop.cropTranslateY,
            cropFrameWidth: crop.cropFrameWidth,
            cropFrameHeight: crop.cropFrameHeight,
            _loFrames,
          },
        });
        // Default-check every AI field that returned a non-empty value
        // so the common case (accept all) is one tap.
        const initialChecked: Record<string, boolean> = {};
        if (aiAnalysis?.name) initialChecked.name = true;
        if (aiAnalysis?.category) initialChecked.category = true;
        if (aiAnalysis?.equipment) initialChecked.equipment = true;
        if (aiAnalysis?.difficulty) initialChecked.difficulty = true;
        if (aiAnalysis?.description) initialChecked.description = true;
        if (aiAnalysis?.muscleGroups?.length) initialChecked.muscleGroups = true;
        if (aiAnalysis?.workSec) initialChecked.workSec = true;
        if (aiAnalysis?.restSec) initialChecked.restSec = true;
        if (aiAnalysis?.regression) initialChecked.regression = true;
        if (aiAnalysis?.progression) initialChecked.progression = true;
        if (aiAnalysis?.contraindications) initialChecked.contraindications = true;
        setAiMergeChecked(initialChecked);
        setProcessingProgress(0);
        setProcessingStatus('');

        // Phase 4: soft duplicate-name warning. If the AI-proposed name
        // matches another movement (not the one being edited), surface a
        // banner in the modal. Reset dismissed state each time the modal
        // re-opens so an old dismissal doesn't bleed across sessions.
        setAiMergeDupDismissed(false);
        setAiMergeDupWarning(null);
        if (aiAnalysis?.name) {
          findDuplicateMovement(aiAnalysis.name).then((m) => {
            if (m) setAiMergeDupWarning(m);
          });
        }
        return;
      }
    } catch (err) {
      console.error('[MovementForm] Processing pipeline error:', err);
      Alert.alert('Error', 'Something went wrong while creating the movement. Please try again.');
      if (isAddVideoSession) {
        addVideoSessionRef.current = false;
        setEditProcessing(false);
      } else {
        setCreateStep('upload');
      }
      setProcessingStatus('');
      setProcessingProgress(0);
    }
  };

  // ── Phase 3: Add-Video CTA entrypoint ──────────────────────────────────
  const startAddVideo = (source: 'library' | 'camera') => {
    addVideoSessionRef.current = true;
    if (source === 'library') {
      pickFromLibrary();
    } else {
      recordFromCamera();
    }
  };

  // ── Phase 3: AI confirm-merge handler ──────────────────────────────────
  // Called from AIConfirmMergeModal. `apply` = false when coach taps "Skip".
  // Always writes derivatives + crop fields (always-update); only writes
  // AI-derived metadata fields the coach checked.
  const handleAiMergeConfirm = async (apply: boolean) => {
    if (!aiMergeData || !editMovement) {
      setAiMergeData(null);
      return;
    }
    const checked = apply ? aiMergeChecked : {};
    const p = aiMergeData.proposed;
    const d = aiMergeData.derivatives;
    const updates: Record<string, any> = {
      videoUrl: d.videoUrl,
      thumbnailUrl: d.thumbnailUrl,
      thumbnailImageUrl: d.thumbnailImageUrl,
      posterUrl: d.posterUrl || d.thumbnailImageUrl || '',
      gifLowUrl: d.gifLowUrl,
      cropScale: d.cropScale,
      cropTranslateX: d.cropTranslateX,
      cropTranslateY: d.cropTranslateY,
      cropFrameWidth: d.cropFrameWidth,
      cropFrameHeight: d.cropFrameHeight,
      updatedAt: serverTimestamp(),
    };
    if (checked.name && p.name) { updates.name = p.name; setName(p.name); }
    if (checked.category && p.category) { updates.category = p.category; setCategory(p.category); }
    if (checked.equipment && p.equipment) { updates.equipment = p.equipment; setEquipment(p.equipment); }
    if (checked.difficulty && p.difficulty) { updates.difficulty = p.difficulty; setDifficulty(p.difficulty); }
    if (checked.description && p.description) { updates.description = p.description; setDescription(p.description); }
    if (checked.muscleGroups && p.muscleGroups?.length) {
      const mf = reconcileMuscleFields(p.muscleGroups, p.primaryMuscles, p.secondaryMuscles);
      updates.muscleGroups = mf.muscleGroups;
      updates.primaryMuscles = mf.primaryMuscles;
      updates.secondaryMuscles = mf.secondaryMuscles;
      setMuscleGroups(mf.muscleGroups);
      setPrimaryMuscles(mf.primaryMuscles);
      setSecondaryMuscles(mf.secondaryMuscles);
    }
    if (checked.workSec && p.workSec) { updates.workSec = p.workSec; setWorkSec(String(p.workSec)); }
    if (checked.restSec && p.restSec) { updates.restSec = p.restSec; setRestSec(String(p.restSec)); }
    if (checked.regression && p.regression) { updates.regression = p.regression; setRegression(p.regression); }
    if (checked.progression && p.progression) { updates.progression = p.progression; setProgression(p.progression); }
    if (checked.contraindications && p.contraindications) { updates.contraindications = p.contraindications; setContraindications(p.contraindications); }

    // Reflect derivative URLs in form state so the live preview updates
    setVideoUrl(d.videoUrl);
    setThumbnailUrl(d.thumbnailUrl);
    setCropScale(d.cropScale);
    setCropTranslateX(d.cropTranslateX);
    setCropTranslateY(d.cropTranslateY);
    setCropFrameWidth(d.cropFrameWidth);
    setCropFrameHeight(d.cropFrameHeight);

    const movementId = editMovement.id;
    try {
      await updateDoc(doc(db, 'movements', movementId), updates);
      savedDocIdRef.current = movementId;

      // Voice regen if name was applied (and changed)
      const newName: string | undefined = updates.name;
      if (newName && newName.trim() && newName.trim() !== lastVoiceNameRef.current) {
        lastVoiceNameRef.current = newName.trim();
        updateDoc(doc(db, 'movements', movementId), { voiceUrl: '', voiceText: '', voiceName: '' }).catch(() => {});
        generateMovementVoice(movementId, newName.trim())
          .then(({ url, text, voiceName }) => {
            if (url) {
              updateDoc(doc(db, 'movements', movementId), { voiceUrl: url, voiceText: text, voiceName }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      // One-rep loop detection (background)
      if (d.gifHighUrl && d._loFrames.length > 0) {
        const gifHighUrl = d.gifHighUrl;
        const loFrames = d._loFrames;
        (async () => {
          try {
            const repAnalysis = await analyzeMovementReps(gifHighUrl);
            if (repAnalysis && repAnalysis.repCount >= 2) {
              const loopBlob = await encodeOneRepLoopGif(loFrames, repAnalysis.loopStartPct, repAnalysis.loopEndPct);
              if (loopBlob) {
                const gifLoopUrl = await uploadBlob(loopBlob, 'thumbnails-loop', 'gif');
                await updateDoc(doc(db, 'movements', movementId), { gifLoopUrl });
              }
            }
          } catch (err) {
            console.warn('[MovementForm] One-rep loop generation failed:', err);
          }
        })();
      }
    } catch (err) {
      console.error('[MovementForm] AI merge confirm error:', err);
      Alert.alert('Error', 'Could not save the video. Please try again.');
    }
    setAiMergeData(null);
    setAiMergeChecked({});
    setAiMergeDupWarning(null);
    setAiMergeDupDismissed(false);
  };

  // ── Muscle group toggle (for edit mode) ───────────────────────────────
  const toggleMuscleGroup = (mg: string) => {
    setMuscleGroups((prev) =>
      prev.includes(mg) ? prev.filter((g) => g !== mg) : [...prev, mg],
    );
  };

  // ── Auto-save helpers (edit mode) ──────────────────────────────────────
  const buildEditPayload = useCallback(() => ({
    name: name.trim(),
    category,
    equipment,
    difficulty,
    description: description.trim(),
    ...reconcileMuscleFields(muscleGroups, primaryMuscles, secondaryMuscles),
    workSec: parseInt(workSec, 10) || 30,
    restSec: parseInt(restSec, 10) || 15,
    countdownSec: parseInt(countdownSec, 10) || 3,
    swapSides,
    swapMode,
    swapWindowSec,
    videoUrl: videoUrl.trim(),
    thumbnailUrl: thumbnailUrl.trim(),
    regression: regression.trim(),
    progression: progression.trim(),
    contraindications: contraindications.trim(),
    cropScale,
    cropTranslateX,
    cropTranslateY,
    cropFrameWidth,
    cropFrameHeight,
    updatedAt: serverTimestamp(),
  }), [name, category, equipment, difficulty, description, muscleGroups, primaryMuscles, secondaryMuscles, workSec, restSec, countdownSec, swapSides, swapMode, swapWindowSec, videoUrl, thumbnailUrl, regression, progression, contraindications, cropScale, cropTranslateX, cropTranslateY, cropFrameWidth, cropFrameHeight]);

  // Regenerate the OpenAI movement voice clip whenever the spoken name
  // changes. Clears voiceUrl synchronously so the player can't speak the old
  // name in the gap between rename and regenerate; on success writes the new
  // URL, on failure leaves voiceUrl cleared so the player falls back to Web
  // Speech reading the NEW name (better than playing the stale old clip).
  const regenerateVoiceIfRenamed = useCallback((movementId: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === lastVoiceNameRef.current) return;
    lastVoiceNameRef.current = trimmed;
    updateDoc(doc(db, 'movements', movementId), { voiceUrl: '', voiceText: '', voiceName: '' }).catch(() => {});
    generateMovementVoice(movementId, trimmed)
      .then(({ url, text, voiceName }) => {
        if (url) {
          updateDoc(doc(db, 'movements', movementId), { voiceUrl: url, voiceText: text, voiceName }).catch(() => {});
        } else {
          console.warn('[MovementForm] Voice regeneration returned no URL for', trimmed);
        }
      })
      .catch((err) => console.warn('[MovementForm] Voice regeneration failed:', err));
  }, [name]);

  const autoSave = useCallback(() => {
    if (!editMovement) return;
    dirtyRef.current = true;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const data = buildEditPayload();
        await updateDoc(doc(db, 'movements', editMovement.id), data);
        dirtyRef.current = false;
        setSaveStatus('saved');
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
        regenerateVoiceIfRenamed(editMovement.id);
        propagateSwapToWorkouts(
          editMovement.id,
          editMovement.coachId ?? coachId,
          { swapSides: data.swapSides, swapMode: data.swapMode, swapWindowSec: data.swapWindowSec },
        );
      } catch (err: any) {
        console.error('[MovementForm] Auto-save error:', err?.message ?? err);
        setSaveStatus('idle');
        dirtyRef.current = false;
      }
    }, 800);
  }, [editMovement, buildEditPayload, regenerateVoiceIfRenamed]);

  const flushSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!editMovement) return;

    try {
      if (dirtyRef.current) {
        const data = buildEditPayload();
        await updateDoc(doc(db, 'movements', editMovement.id), data);
        dirtyRef.current = false;
        propagateSwapToWorkouts(
          editMovement.id,
          editMovement.coachId ?? coachId,
          { swapSides: data.swapSides, swapMode: data.swapMode, swapWindowSec: data.swapWindowSec },
        );
      }
      // Always check for a pending rename, even when dirtyRef is already
      // false (e.g. autoSave's debounced write committed before the user
      // closed the modal). lastVoiceNameRef gates this so we only regenerate
      // when the spoken name actually changed since the last generation.
      regenerateVoiceIfRenamed(editMovement.id);
    } catch (err: any) {
      console.error('[MovementForm] Flush-save error:', err?.message ?? err);
    }
  }, [editMovement, buildEditPayload, regenerateVoiceIfRenamed]);

  // Track whether initial population from editMovement is done
  const initializedRef = useRef(false);

  // Mark initialized after editMovement populates the form
  useEffect(() => {
    if (editMovement && visible) {
      // Give the pre-populate effect a tick to run before arming auto-save
      const t = setTimeout(() => { initializedRef.current = true; }, 50);
      return () => clearTimeout(t);
    } else {
      initializedRef.current = false;
    }
  }, [editMovement, visible]);

  // Auto-save whenever any editable field changes (edit mode only)
  useEffect(() => {
    if (!isEdit || !initializedRef.current) return;
    autoSave();
  }, [name, category, equipment, difficulty, description, muscleGroups, primaryMuscles, secondaryMuscles, workSec, restSec, countdownSec, swapSides, swapMode, swapWindowSec, videoUrl, thumbnailUrl, regression, progression, contraindications, cropScale, cropTranslateX, cropTranslateY, cropFrameWidth, cropFrameHeight]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // ── Edit mode submit (legacy — kept for reference but no longer primary) ──
  const handleEditSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a movement name.');
      return;
    }

    setSubmitting(true);
    try {
      // Auto-generate GIF for URL-only movements that were never reframed
      const trimmedVideoUrl = videoUrl.trim();
      if (
        Platform.OS === 'web' &&
        trimmedVideoUrl &&
        !thumbnailUrl.trim() &&
        !gifPromiseRef.current
      ) {
        generateAndUploadGif(trimmedVideoUrl, {
          cropScale,
          cropTranslateX,
          cropTranslateY,
          cropFrameWidth,
          cropFrameHeight,
        });
      }

      // If GIF is still generating, wait for it
      let finalThumbnailUrl = thumbnailUrl.trim();
      if (gifPromiseRef.current) {
        try {
          const gifUrl = await gifPromiseRef.current;
          if (gifUrl) finalThumbnailUrl = gifUrl;
        } catch {
          // GIF failed — save without it
        }
        gifPromiseRef.current = null;
      }

      const data: Record<string, any> = {
        name: name.trim(),
        category,
        equipment,
        difficulty,
        description: description.trim(),
        ...reconcileMuscleFields(muscleGroups, primaryMuscles, secondaryMuscles),
        workSec: parseInt(workSec, 10) || 30,
        restSec: parseInt(restSec, 10) || 15,
        countdownSec: parseInt(countdownSec, 10) || 3,
        swapSides,
        swapMode,
        swapWindowSec,
        videoUrl: videoUrl.trim(),
        thumbnailUrl: finalThumbnailUrl,
        regression: regression.trim(),
        progression: progression.trim(),
        contraindications: contraindications.trim(),
        cropScale,
        cropTranslateX,
        cropTranslateY,
        cropFrameWidth,
        cropFrameHeight,
        updatedAt: serverTimestamp(),
      };

      const docId = editMovement!.id;
      await updateDoc(doc(db, 'movements', docId), data);
      savedDocIdRef.current = docId;
      propagateSwapToWorkouts(
        docId,
        editMovement!.coachId ?? coachId,
        { swapSides, swapMode, swapWindowSec },
      );

      // Regenerate voice if name changed.
      // Clear voiceUrl immediately so the player can't speak the old name in
      // the gap between rename and regenerate. On success, write the new URL;
      // on failure, leave voiceUrl cleared so Web Speech reads the new name.
      const prevName = editMovement?.name?.trim() ?? null;
      const newName = name.trim();
      if (prevName !== newName) {
        updateDoc(doc(db, 'movements', docId), { voiceUrl: '', voiceText: '', voiceName: '' }).catch(() => {});
        generateMovementVoice(docId, newName)
          .then(({ url, text, voiceName }) => {
            if (url) {
              updateDoc(doc(db, 'movements', docId), { voiceUrl: url, voiceText: text, voiceName }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      resetForm();
      onClose();
    } catch (error) {
      console.error('[MovementForm] Save error:', error);
      Alert.alert('Error', 'Could not update movement.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────

  // ── EDIT MODE: Full metadata form ──────────────────────────────────────
  if (isEdit) {
    return (
      <>
        <ModalSheet visible={visible} onClose={async () => { await flushSave(); initializedRef.current = false; onClose(); }} maxHeightPct={0.9}>
              <View style={st.header}>
                <Text style={st.headerTitle}>Edit Movement</Text>
                <Pressable onPress={async () => { await flushSave(); initializedRef.current = false; onClose(); }} hitSlop={8}>
                  <Icon name="close" size={24} color="#8A95A3" />
                </Pressable>
              </View>

              <ScrollView
                style={st.scroll}
                contentContainerStyle={st.scrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {/* Movement Name */}
                <Text style={st.label}>Movement Name</Text>
                <TextInput
                  ref={editNameInputRef}
                  style={st.input}
                  value={name}
                  onChangeText={(t) => setName(toTitleCase(t))}
                  onBlur={() => setName((n) => toTitleCase(n))}
                  placeholder="e.g. Back Squat"
                  placeholderTextColor="#4A5568"
                  autoCapitalize="words"
                />

                {/* Category */}
                <Text style={st.label}>Category</Text>
                <View style={st.chipRow}>
                  {CATEGORY_OPTIONS.map((opt) => {
                    const active = category === opt;
                    return (
                      <Pressable
                        key={opt}
                        style={[st.chip, active && st.chipActive]}
                        onPress={() => setCategory(opt)}
                      >
                        <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Equipment */}
                <Text style={st.label}>Equipment</Text>
                <View style={st.chipRow}>
                  {EQUIPMENT_OPTIONS.map((opt) => {
                    const active = equipment === opt;
                    return (
                      <Pressable
                        key={opt}
                        style={[st.chip, active && st.chipActive]}
                        onPress={() => setEquipment(active ? '' : opt)}
                      >
                        <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Difficulty */}
                <Text style={st.label}>Difficulty</Text>
                <View style={st.chipRow}>
                  {DIFFICULTY_OPTIONS.map((opt) => {
                    const active = difficulty === opt;
                    return (
                      <Pressable
                        key={opt}
                        style={[st.chip, active && st.chipActive]}
                        onPress={() => setDifficulty(active ? '' : opt)}
                      >
                        <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Muscle Groups */}
                <Text style={st.label}>Muscle Groups</Text>
                <View style={st.chipRow}>
                  {MUSCLE_GROUP_OPTIONS.map((mg) => {
                    const active = muscleGroups.includes(mg);
                    return (
                      <Pressable
                        key={mg}
                        style={[st.chip, active && st.chipActive]}
                        onPress={() => toggleMuscleGroup(mg)}
                      >
                        <Text style={[st.chipText, active && st.chipTextActive]}>{mg}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Description */}
                <Text style={st.label}>Description / Coaching Cues</Text>
                <TextInput
                  style={[st.input, st.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Coaching cues, notes, or instructions..."
                  placeholderTextColor="#4A5568"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                {/* Timer Defaults */}
                <Text style={st.sectionTitle}>Timer Defaults</Text>
                <View style={st.timerRow}>
                  <View style={st.timerField}>
                    <Text style={st.timerLabel}>Work (sec)</Text>
                    <TextInput
                      style={st.timerInput}
                      value={workSec}
                      onChangeText={setWorkSec}
                      keyboardType="numeric"
                      placeholder="30"
                      placeholderTextColor="#4A5568"
                    />
                  </View>
                  <View style={st.timerField}>
                    <Text style={st.timerLabel}>Rest (sec)</Text>
                    <TextInput
                      style={st.timerInput}
                      value={restSec}
                      onChangeText={setRestSec}
                      keyboardType="numeric"
                      placeholder="15"
                      placeholderTextColor="#4A5568"
                    />
                  </View>
                  <View style={st.timerField}>
                    <Text style={st.timerLabel}>Countdown</Text>
                    <TextInput
                      style={st.timerInput}
                      value={countdownSec}
                      onChangeText={setCountdownSec}
                      keyboardType="numeric"
                      placeholder="3"
                      placeholderTextColor="#4A5568"
                    />
                  </View>
                </View>

                {/* Swap Sides */}
                <Pressable style={st.toggleRow} onPress={() => setSwapSides(!swapSides)}>
                  <View>
                    <Text style={st.toggleLabel}>Swap Sides</Text>
                    <Text style={st.toggleHint}>Automatically split work time for left/right sides</Text>
                  </View>
                  <View style={[st.toggleTrack, swapSides && st.toggleTrackActive]}>
                    <View style={[st.toggleThumb, swapSides && st.toggleThumbActive]} />
                  </View>
                </Pressable>

                {/* Swap Sides — mode + window (visible when toggle on) */}
                {swapSides && (
                  <View style={st.swapSettingsBlock}>
                    <View style={st.swapSettingsRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.swapSettingsLabel}>Mode</Text>
                        <Text style={st.swapSettingsHint}>
                          {swapMode === 'split'
                            ? 'Half on each side (½ of work time per side)'
                            : 'Full duration on both sides (2× total)'}
                        </Text>
                      </View>
                      <Pressable
                        style={st.swapModePill}
                        onPress={() => setSwapMode(swapMode === 'split' ? 'duplicate' : 'split')}
                      >
                        <Text style={st.swapModePillText}>{swapMode === 'split' ? '½' : '2×'}</Text>
                      </Pressable>
                    </View>
                    <View style={st.swapSettingsRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.swapSettingsLabel}>Swap Window</Text>
                        <Text style={st.swapSettingsHint}>Countdown before "swap sides" cue (0–15s). 0 = skip the visual countdown and flip sides instantly with a combined "3, 2, 1, go on the other side" cue.</Text>
                      </View>
                      <View style={st.swapWindowStepper}>
                        <Pressable
                          style={st.swapStepBtn}
                          onPress={() => setSwapWindowSec((s) => Math.max(0, s - 1))}
                        >
                          <Text style={st.swapStepBtnText}>−</Text>
                        </Pressable>
                        <Text style={st.swapWindowValue}>{swapWindowSec}s</Text>
                        <Pressable
                          style={st.swapStepBtn}
                          onPress={() => setSwapWindowSec((s) => Math.min(15, s + 1))}
                        >
                          <Text style={st.swapStepBtnText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )}

                {/* Media */}
                <Text style={st.sectionTitle}>Media</Text>
                {videoUrl && isImageUrl(videoUrl) ? (
                  <View style={{ marginBottom: 8 }}>
                    <Image
                      source={{ uri: videoUrl }}
                      style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: 12, backgroundColor: '#0E1117' }}
                      resizeMode="cover"
                    />
                    <View style={st.mediaAttached}>
                      <Icon name="checkmark" size={14} color="#6EBB7A" />
                      <Text style={st.mediaAttachedText}>Photo attached</Text>
                    </View>
                  </View>
                ) : videoUrl ? (
                  <View style={{ marginBottom: 8 }}>
                    <MovementVideoControls
                      uri={videoUrl}
                      posterUri={thumbnailUrl || undefined}
                      aspectRatio={4 / 5}
                      autoPlay={false}
                      showControls={true}
                      cropScale={cropScale}
                      cropTranslateX={cropTranslateX}
                      cropTranslateY={cropTranslateY}
                    />
                    <View style={st.mediaAttached}>
                      <Icon name="checkmark" size={14} color="#6EBB7A" />
                      <Text style={st.mediaAttachedText}>Video attached</Text>
                      <Pressable
                        style={st.reframeBtn}
                        onPress={() => setShowCropModal(true)}
                        hitSlop={8}
                      >
                        <Icon name="crop" size={12} color="#F5A623" />
                        <Text style={st.reframeBtnText}>Reframe</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  // Phase 3 placeholder "Add Video" CTA — appears in edit mode when
                  // the movement was created without a video. Picks/records a clip,
                  // runs the full derivatives + AI pipeline, then opens the AI
                  // confirm-merge modal so the coach picks which fields to overwrite.
                  <View style={st.addVideoCta}>
                    {uploading ? (
                      <View style={st.uploadingContainer}>
                        <ActivityIndicator size="small" color="#F5A623" />
                        <Text style={st.uploadingText}>
                          Uploading... {Math.round(uploadProgress * 100)}%
                        </Text>
                        <View style={st.progressBarSmall}>
                          <View
                            style={[
                              st.progressFillSmall,
                              { width: `${Math.round(uploadProgress * 100)}%` },
                            ]}
                          />
                        </View>
                      </View>
                    ) : (
                      <>
                        <Text style={st.addVideoCtaTitle}>Add a video or photo</Text>
                        <Text style={st.addVideoCtaHint}>
                          This movement was created without media. Add a video and AI will suggest fields, or add a photo.
                        </Text>
                        <View style={st.addVideoCtaRow}>
                          <Pressable
                            style={st.addVideoCtaBtn}
                            onPress={() => startAddVideo('library')}
                          >
                            <Icon name="image" size={18} color="#F5A623" />
                            <Text style={st.addVideoCtaBtnText}>Pick from Library</Text>
                          </Pressable>
                          <Pressable
                            style={st.addVideoCtaBtn}
                            onPress={() => startAddVideo('camera')}
                          >
                            <Icon name="camera" size={18} color="#F5A623" />
                            <Text style={st.addVideoCtaBtnText}>Record</Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                )}

                {/* Regression / Progression */}
                <Text style={st.label}>Regression (Easier Alternative)</Text>
                <TextInput
                  style={st.input}
                  value={regression}
                  onChangeText={setRegression}
                  placeholder="e.g. Knee push-ups, Assisted pull-ups..."
                  placeholderTextColor="#4A5568"
                  autoCapitalize="sentences"
                />

                <Text style={st.label}>Progression (Harder Alternative)</Text>
                <TextInput
                  style={st.input}
                  value={progression}
                  onChangeText={setProgression}
                  placeholder="e.g. Weighted push-ups, Archer pull-ups..."
                  placeholderTextColor="#4A5568"
                  autoCapitalize="sentences"
                />

                <Text style={st.label}>Contraindications</Text>
                <TextInput
                  style={[st.input, { minHeight: 60 }]}
                  value={contraindications}
                  onChangeText={setContraindications}
                  placeholder="e.g. Avoid with lower back injury..."
                  placeholderTextColor="#4A5568"
                  autoCapitalize="sentences"
                  multiline
                  numberOfLines={2}
                />
              </ScrollView>

              {/* Footer — auto-save status + done button */}
              <View style={st.footer}>
                <View style={st.autoSaveStatus}>
                  {saveStatus === 'saving' && (
                    <>
                      <ActivityIndicator size="small" color="#F5A623" />
                      <Text style={st.autoSaveText}>Saving...</Text>
                    </>
                  )}
                  {saveStatus === 'saved' && (
                    <>
                      <Icon name="checkmark" size={14} color="#6EBB7A" />
                      <Text style={[st.autoSaveText, { color: '#6EBB7A' }]}>Saved</Text>
                    </>
                  )}
                </View>
                <Pressable
                  style={st.doneBtn}
                  onPress={async () => {
                    await flushSave();
                    initializedRef.current = false;
                    onClose();
                  }}
                >
                  <Text style={st.doneBtnText}>Done</Text>
                </Pressable>
              </View>
        </ModalSheet>

        <VideoCropModal
          visible={showCropModal}
          videoUri={videoUrl}
          initialCrop={{ cropScale, cropTranslateX, cropTranslateY, cropFrameWidth, cropFrameHeight }}
          onDone={(crop: CropValues) => {
            // Phase 3: when the coach is adding a video to a placeholder,
            // run the full derivatives + AI pipeline (processAfterCrop)
            // instead of the legacy GIF-only reframe path.
            if (addVideoSessionRef.current) {
              processAfterCrop(crop);
              return;
            }
            setCropScale(crop.cropScale);
            setCropTranslateX(crop.cropTranslateX);
            setCropTranslateY(crop.cropTranslateY);
            setCropFrameWidth(crop.cropFrameWidth);
            setCropFrameHeight(crop.cropFrameHeight);
            setShowCropModal(false);
            generateAndUploadGif(videoUrl, crop);
          }}
          onCancel={() => {
            setShowCropModal(false);
            // If the coach cancels crop during an add-video session, drop
            // the just-uploaded clip so the placeholder CTA reappears.
            if (addVideoSessionRef.current) {
              addVideoSessionRef.current = false;
              setVideoUrl('');
            }
          }}
        />

        {/* Phase 3: full-screen processing overlay while derivatives + AI run */}
        <Modal visible={editProcessing} transparent animationType="fade">
          <View style={st.editProcessingOverlay}>
            <ActivityIndicator size="large" color="#F5A623" />
            <Text style={st.editProcessingText}>{editProcessingStatus}</Text>
          </View>
        </Modal>

        {/* Phase 3: AI confirm-merge modal (policy C — opt-in per field) */}
        <AIConfirmMergeModal
          data={aiMergeData}
          checked={aiMergeChecked}
          onToggle={(key) => setAiMergeChecked((prev) => ({ ...prev, [key]: !prev[key] }))}
          onSkip={() => handleAiMergeConfirm(false)}
          onApply={() => handleAiMergeConfirm(true)}
          dupWarning={aiMergeDupWarning}
          dupWarningDismissed={aiMergeDupDismissed}
          onDismissDupWarning={() => setAiMergeDupDismissed(true)}
          onRenameDup={() => {
            // Close the modal so the coach can edit the name in the
            // underlying edit form. Treat as "skip AI" so we don't
            // overwrite their existing name. Then focus the name input.
            handleAiMergeConfirm(false);
            setTimeout(() => editNameInputRef.current?.focus(), 100);
          }}
        />
      </>
    );
  }

  // ── CREATE MODE: Simplified 3-step flow ────────────────────────────────
  return (
    <>
      <ModalSheet visible={visible} onClose={() => { resetForm(); onClose(); }} maxHeightPct={0.92}>
            {/* Close button — always visible */}
            <Pressable
              style={st.createCloseBtn}
              onPress={() => {
                resetForm();
                onClose();
              }}
              hitSlop={12}
            >
              <Icon name="close" size={24} color="#8A95A3" />
            </Pressable>

            {/* ── STEP 1: Upload ──────────────────────────────────── */}
            {createStep === 'upload' && (
              <View style={st.uploadScreen}>
                {/* 4:5 frame with "+" */}
                <View style={st.uploadFrame}>
                  {uploading ? (
                    <View style={st.uploadingContainer}>
                      <ActivityIndicator size="large" color="#F5A623" />
                      <Text style={st.uploadingText}>
                        Uploading... {Math.round(uploadProgress * 100)}%
                      </Text>
                      <View style={st.progressBarSmall}>
                        <View
                          style={[
                            st.progressFillSmall,
                            { width: `${Math.round(uploadProgress * 100)}%` },
                          ]}
                        />
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={st.frameBorder}>
                        <View style={st.frameCornerTL} />
                        <View style={st.frameCornerTR} />
                        <View style={st.frameCornerBL} />
                        <View style={st.frameCornerBR} />
                      </View>
                      <View style={st.uploadActions}>
                        <Pressable style={st.uploadActionBtn} onPress={pickFromLibrary}>
                          <View style={st.uploadPlusCircle}>
                            <Icon name="image" size={28} color="#F5A623" />
                          </View>
                          <Text style={st.uploadActionLabel}>Upload</Text>
                        </Pressable>
                        <Pressable style={st.uploadActionBtn} onPress={recordFromCamera}>
                          <View style={st.uploadPlusCircle}>
                            <Icon name="camera" size={28} color="#F5A623" />
                          </View>
                          <Text style={st.uploadActionLabel}>Record</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>

                <Text style={st.uploadHint}>
                  Upload a photo or video, or record a demo (up to 25 sec)
                </Text>

                <Pressable style={st.noVideoBtn} onPress={startNoVideoCreate}>
                  <Icon name="document" size={18} color="#8A95A3" />
                  <Text style={st.noVideoBtnLabel}>Create without video</Text>
                </Pressable>
                <Text style={st.noVideoBtnHint}>
                  You can add the video later — the movement will work in workouts now.
                </Text>
              </View>
            )}

            {/* ── STEP 2: Crop (handled by VideoCropModal) ────────── */}
            {createStep === 'crop' && !showCropModal && (
              <View style={st.uploadScreen}>
                <View style={st.uploadFrame}>
                  <ActivityIndicator size="large" color="#F5A623" />
                  <Text style={st.uploadingText}>Preparing crop...</Text>
                </View>
              </View>
            )}

            {/* ── STEP 3: Processing ──────────────────────────────── */}
            {createStep === 'processing' && (
              <View style={st.processingScreen}>
                {/* Video loops in 4:5 frame */}
                <View style={st.processingFrame}>
                  {videoUrl ? (
                    <MovementVideoControls
                      uri={videoUrl}
                      posterUri={thumbnailUrl || undefined}
                      aspectRatio={4 / 5}
                      autoPlay={true}
                      showControls={false}
                      cropScale={cropScale}
                      cropTranslateX={cropTranslateX}
                      cropTranslateY={cropTranslateY}
                    />
                  ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                      <ActivityIndicator size="large" color="#F5A623" />
                    </View>
                  )}

                  {/* Subtle overlay with progress */}
                  <View style={st.processingOverlay}>
                    <View style={st.processingPill}>
                      <ActivityIndicator size="small" color="#F5A623" />
                      <Text style={st.processingPillText}>{processingStatus}</Text>
                    </View>
                  </View>
                </View>

                {/* Progress bar */}
                <View style={st.processingProgressBar}>
                  <View
                    style={[
                      st.processingProgressFill,
                      { width: `${Math.round(processingProgress * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* ── STEP: No-video metadata form ───────────────────── */}
            {createStep === 'no-video-meta' && (
              <>
                <View style={st.header}>
                  <Text style={st.headerTitle}>
                    {isImageUrl(videoUrl) ? 'Create movement (photo)' : 'Create movement (no video yet)'}
                  </Text>
                  <View style={{ width: 36 }} />
                </View>

                <ScrollView
                  style={st.scroll}
                  contentContainerStyle={st.scrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={st.label}>Movement Name *</Text>
                  <TextInput
                    ref={noVideoNameInputRef}
                    style={st.input}
                    value={name}
                    onChangeText={(t) => setName(toTitleCase(t))}
                    onBlur={() => setName((n) => toTitleCase(n))}
                    placeholder="e.g. Back Squat"
                    placeholderTextColor="#4A5568"
                    autoCapitalize="words"
                    autoFocus
                  />

                  <Text style={st.label}>Category</Text>
                  <View style={st.chipRow}>
                    {CATEGORY_OPTIONS.map((opt) => {
                      const active = category === opt;
                      return (
                        <Pressable
                          key={opt}
                          style={[st.chip, active && st.chipActive]}
                          onPress={() => setCategory(active ? '' : opt)}
                        >
                          <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={st.label}>Equipment</Text>
                  <View style={st.chipRow}>
                    {EQUIPMENT_OPTIONS.map((opt) => {
                      const active = equipment === opt;
                      return (
                        <Pressable
                          key={opt}
                          style={[st.chip, active && st.chipActive]}
                          onPress={() => setEquipment(active ? '' : opt)}
                        >
                          <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={st.label}>Difficulty</Text>
                  <View style={st.chipRow}>
                    {DIFFICULTY_OPTIONS.map((opt) => {
                      const active = difficulty === opt;
                      return (
                        <Pressable
                          key={opt}
                          style={[st.chip, active && st.chipActive]}
                          onPress={() => setDifficulty(active ? '' : opt)}
                        >
                          <Text style={[st.chipText, active && st.chipTextActive]}>{opt}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={st.label}>Muscle Groups</Text>
                  <View style={st.chipRow}>
                    {MUSCLE_GROUP_OPTIONS.map((mg) => {
                      const active = muscleGroups.includes(mg);
                      return (
                        <Pressable
                          key={mg}
                          style={[st.chip, active && st.chipActive]}
                          onPress={() => toggleMuscleGroup(mg)}
                        >
                          <Text style={[st.chipText, active && st.chipTextActive]}>{mg}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={st.label}>Description / Coaching Cues</Text>
                  <TextInput
                    style={[st.input, st.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Coaching cues, notes, or instructions..."
                    placeholderTextColor="#4A5568"
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />

                  <Text style={st.sectionTitle}>Timer Defaults</Text>
                  <View style={st.timerRow}>
                    <View style={st.timerField}>
                      <Text style={st.timerLabel}>Work (sec)</Text>
                      <TextInput
                        style={st.timerInput}
                        value={workSec}
                        onChangeText={setWorkSec}
                        keyboardType="numeric"
                        placeholder="30"
                        placeholderTextColor="#4A5568"
                      />
                    </View>
                    <View style={st.timerField}>
                      <Text style={st.timerLabel}>Rest (sec)</Text>
                      <TextInput
                        style={st.timerInput}
                        value={restSec}
                        onChangeText={setRestSec}
                        keyboardType="numeric"
                        placeholder="15"
                        placeholderTextColor="#4A5568"
                      />
                    </View>
                  </View>

                  <Pressable style={st.toggleRow} onPress={() => setSwapSides(!swapSides)}>
                    <View>
                      <Text style={st.toggleLabel}>Swap Sides</Text>
                      <Text style={st.toggleHint}>Automatically split work time for left/right sides</Text>
                    </View>
                    <View style={[st.toggleTrack, swapSides && st.toggleTrackActive]}>
                      <View style={[st.toggleThumb, swapSides && st.toggleThumbActive]} />
                    </View>
                  </Pressable>

                  {swapSides && (
                    <View style={st.swapSettingsBlock}>
                      <View style={st.swapSettingsRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={st.swapSettingsLabel}>Mode</Text>
                          <Text style={st.swapSettingsHint}>
                            {swapMode === 'split'
                              ? 'Half on each side (½ of work time per side)'
                              : 'Full duration on both sides (2× total)'}
                          </Text>
                        </View>
                        <Pressable
                          style={st.swapModePill}
                          onPress={() => setSwapMode(swapMode === 'split' ? 'duplicate' : 'split')}
                        >
                          <Text style={st.swapModePillText}>{swapMode === 'split' ? '½' : '2×'}</Text>
                        </Pressable>
                      </View>
                      <View style={st.swapSettingsRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={st.swapSettingsLabel}>Swap Window</Text>
                          <Text style={st.swapSettingsHint}>Countdown before "swap sides" cue (0–15s)</Text>
                        </View>
                        <View style={st.swapWindowStepper}>
                          <Pressable
                            style={st.swapStepBtn}
                            onPress={() => setSwapWindowSec((s) => Math.max(0, s - 1))}
                          >
                            <Text style={st.swapStepBtnText}>−</Text>
                          </Pressable>
                          <Text style={st.swapWindowValue}>{swapWindowSec}s</Text>
                          <Pressable
                            style={st.swapStepBtn}
                            onPress={() => setSwapWindowSec((s) => Math.min(15, s + 1))}
                          >
                            <Text style={st.swapStepBtnText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )}

                  <Text style={st.label}>Regression (Easier Alternative)</Text>
                  <TextInput
                    style={st.input}
                    value={regression}
                    onChangeText={setRegression}
                    placeholder="e.g. Knee push-ups, Assisted pull-ups..."
                    placeholderTextColor="#4A5568"
                    autoCapitalize="sentences"
                  />

                  <Text style={st.label}>Progression (Harder Alternative)</Text>
                  <TextInput
                    style={st.input}
                    value={progression}
                    onChangeText={setProgression}
                    placeholder="e.g. Weighted push-ups, Archer pull-ups..."
                    placeholderTextColor="#4A5568"
                    autoCapitalize="sentences"
                  />

                  <Text style={st.label}>Contraindications</Text>
                  <TextInput
                    style={[st.input, { minHeight: 60 }]}
                    value={contraindications}
                    onChangeText={setContraindications}
                    placeholder="e.g. Avoid with lower back injury..."
                    placeholderTextColor="#4A5568"
                    autoCapitalize="sentences"
                    multiline
                    numberOfLines={2}
                  />
                </ScrollView>

                {noVideoDupWarning && (
                  <DuplicateNameWarningBanner
                    existingName={noVideoDupWarning.name}
                    onSaveAnyway={async () => {
                      setNoVideoDupWarning(null);
                      await saveNoVideoMovement();
                    }}
                    onRename={() => {
                      setNoVideoDupWarning(null);
                      // setTimeout lets the banner unmount first so focus lands
                      // cleanly on the name TextInput.
                      setTimeout(() => {
                        noVideoNameInputRef.current?.focus();
                      }, 50);
                    }}
                  />
                )}

                <View style={st.footer}>
                  <Pressable style={st.cancelBtn} onPress={() => setCreateStep('upload')}>
                    <Text style={st.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[st.saveBtn, (!name.trim() || submitting) && st.saveBtnDisabled]}
                    onPress={handleNoVideoSavePressed}
                    disabled={!name.trim() || submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#0E1117" />
                    ) : (
                      <Text style={st.saveBtnText}>Create</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
      </ModalSheet>

      {/* Crop Modal — rendered OUTSIDE so it layers on top on iOS */}
      <VideoCropModal
        visible={showCropModal}
        videoUri={videoUrl}
        initialCrop={{ cropScale, cropTranslateX, cropTranslateY, cropFrameWidth, cropFrameHeight }}
        onDone={(crop: CropValues) => {
          processAfterCrop(crop);
        }}
        onCancel={() => {
          setShowCropModal(false);
          setCreateStep('upload');
          setVideoUrl('');
        }}
      />
    </>
  );
}

// ── Phase 4: duplicate-name soft warning banner ─────────────────────────
// Shared between the AI confirm-merge modal and the no-video-create flow.
// Yellow/amber bar. Two buttons — Save anyway is dismissive, Rename hands
// focus back to the name input upstream.
interface DuplicateNameWarningBannerProps {
  existingName: string;
  onSaveAnyway: () => void;
  onRename: () => void;
}

function DuplicateNameWarningBanner({
  existingName,
  onSaveAnyway,
  onRename,
}: DuplicateNameWarningBannerProps) {
  return (
    <View style={st.dupWarnBanner}>
      <View style={st.dupWarnTextWrap}>
        <Icon name="warning" size={16} color="#F5A623" />
        <Text style={st.dupWarnText}>
          You already have a movement called{' '}
          <Text style={st.dupWarnTextBold}>{existingName}</Text>. Save as
          duplicate, or rename?
        </Text>
      </View>
      <View style={st.dupWarnBtnRow}>
        <Pressable style={st.dupWarnSaveBtn} onPress={onSaveAnyway} hitSlop={6}>
          <Text style={st.dupWarnSaveBtnText}>Save anyway</Text>
        </Pressable>
        <Pressable style={st.dupWarnRenameBtn} onPress={onRename} hitSlop={6}>
          <Text style={st.dupWarnRenameBtnText}>Rename</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Phase 3: AI confirm-merge modal ─────────────────────────────────────
// Renders side-by-side existing vs. AI-proposed values with an opt-in
// checkbox per field. Coach taps Apply Selected to write checked fields;
// Skip writes only derivative/crop fields (no AI metadata overwrite).
type AIMergeFieldKey =
  | 'name'
  | 'category'
  | 'equipment'
  | 'difficulty'
  | 'description'
  | 'muscleGroups'
  | 'workSec'
  | 'restSec'
  | 'regression'
  | 'progression'
  | 'contraindications';

const AI_MERGE_FIELDS: { key: AIMergeFieldKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'muscleGroups', label: 'Muscle Groups' },
  { key: 'description', label: 'Description' },
  { key: 'workSec', label: 'Work (sec)' },
  { key: 'restSec', label: 'Rest (sec)' },
  { key: 'regression', label: 'Regression' },
  { key: 'progression', label: 'Progression' },
  { key: 'contraindications', label: 'Contraindications' },
];

interface AIConfirmMergeModalProps {
  data: {
    proposed: MovementAnalysis;
    existing: {
      name: string;
      category: string;
      equipment: string;
      difficulty: string;
      description: string;
      muscleGroups: string[];
      workSec: number;
      restSec: number;
      regression: string;
      progression: string;
      contraindications: string;
    };
  } | null;
  checked: Record<string, boolean>;
  onToggle: (key: AIMergeFieldKey) => void;
  onSkip: () => void;
  onApply: () => void;
  // Phase 4: soft duplicate-name warning. Banner renders when a match is
  // present, the coach hasn't dismissed it, and the AI name overwrite is
  // checked (toggling name off makes the warning irrelevant).
  dupWarning: { id: string; name: string } | null;
  dupWarningDismissed: boolean;
  onDismissDupWarning: () => void;
  onRenameDup: () => void;
}

function formatMergeValue(key: AIMergeFieldKey, raw: any): string {
  if (raw === null || raw === undefined) return '—';
  if (key === 'muscleGroups') {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.length ? arr.join(', ') : '—';
  }
  const s = String(raw).trim();
  return s.length ? s : '—';
}

function AIConfirmMergeModal({
  data,
  checked,
  onToggle,
  onSkip,
  onApply,
  dupWarning,
  dupWarningDismissed,
  onDismissDupWarning,
  onRenameDup,
}: AIConfirmMergeModalProps) {
  if (!data) return null;
  const { proposed, existing } = data;
  // Banner shows only when the coach actually intends to overwrite the
  // name. If they uncheck name, the duplicate becomes a non-issue.
  const showDupBanner = !!dupWarning && !dupWarningDismissed && !!checked.name;
  return (
    <Modal visible={!!data} transparent animationType="slide" onRequestClose={onSkip}>
      <View style={st.aiMergeBackdrop}>
        <View style={st.aiMergeSheet}>
          <View style={st.aiMergeHeader}>
            <Text style={st.aiMergeTitle}>Apply AI suggestions?</Text>
            <Text style={st.aiMergeSubtitle}>
              Check each field you want to overwrite. The video and crop are saved either way.
            </Text>
          </View>
          {showDupBanner && dupWarning && (
            <DuplicateNameWarningBanner
              existingName={dupWarning.name}
              onSaveAnyway={onDismissDupWarning}
              onRename={onRenameDup}
            />
          )}
          <ScrollView
            style={st.aiMergeScroll}
            contentContainerStyle={st.aiMergeScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {AI_MERGE_FIELDS.map(({ key, label }) => {
              const proposedVal = formatMergeValue(key, (proposed as any)[key]);
              const existingVal = formatMergeValue(key, (existing as any)[key]);
              const isChecked = !!checked[key];
              // Hide rows where AI returned nothing useful — coach can't overwrite
              // existing values with empty AI output.
              if (proposedVal === '—') return null;
              const changed = proposedVal !== existingVal;
              return (
                <Pressable
                  key={key}
                  style={[st.aiMergeRow, !changed && st.aiMergeRowUnchanged]}
                  onPress={() => onToggle(key)}
                >
                  <View style={[st.aiMergeCheckbox, isChecked && st.aiMergeCheckboxChecked]}>
                    {isChecked ? <Icon name="checkmark" size={14} color="#0E1117" /> : null}
                  </View>
                  <View style={st.aiMergeRowBody}>
                    <Text style={st.aiMergeRowLabel}>{label}</Text>
                    <View style={st.aiMergeValues}>
                      <View style={st.aiMergeValueCol}>
                        <Text style={st.aiMergeValueTag}>Current</Text>
                        <Text style={st.aiMergeValueExisting} numberOfLines={3}>{existingVal}</Text>
                      </View>
                      <View style={st.aiMergeValueCol}>
                        <Text style={[st.aiMergeValueTag, st.aiMergeValueTagAi]}>AI</Text>
                        <Text style={st.aiMergeValueProposed} numberOfLines={3}>{proposedVal}</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={st.aiMergeFooter}>
            <Pressable style={st.aiMergeSkipBtn} onPress={onSkip}>
              <Text style={st.aiMergeSkipBtnText}>Skip suggestions</Text>
            </Pressable>
            <Pressable style={st.aiMergeApplyBtn} onPress={onApply}>
              <Text style={st.aiMergeApplyBtnText}>Apply selected</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  // overlay + sheet styles removed — now handled by ModalSheet component
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },

  // createSheet styles removed — now handled by ModalSheet component
  createCloseBtn: {
    position: 'absolute',
    top: Platform.select({ ios: 16, default: 16 }),
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Step 1: Upload screen ─────────────────────────────────────────────
  uploadScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  uploadFrame: {
    width: '80%',
    maxWidth: 320,
    aspectRatio: 4 / 5,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  frameBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  frameCornerTL: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 32,
    height: 32,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: 'rgba(245,166,35,0.4)',
    borderTopLeftRadius: 16,
  },
  frameCornerTR: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 32,
    height: 32,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(245,166,35,0.4)',
    borderTopRightRadius: 16,
  },
  frameCornerBL: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 32,
    height: 32,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderColor: 'rgba(245,166,35,0.4)',
    borderBottomLeftRadius: 16,
  },
  frameCornerBR: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: 'rgba(245,166,35,0.4)',
    borderBottomRightRadius: 16,
  },
  uploadActions: {
    flexDirection: 'row',
    gap: 40,
    alignItems: 'center',
  },
  uploadActionBtn: {
    alignItems: 'center',
    gap: 10,
  },
  uploadPlusCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  uploadHint: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 24,
  },
  uploadingContainer: {
    alignItems: 'center',
    gap: 12,
    padding: 20,
    width: '100%',
  },
  uploadingText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },
  progressBarSmall: {
    width: '80%',
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFillSmall: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },

  // ── Step 3: Processing screen ─────────────────────────────────────────
  processingScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  processingFrame: {
    width: '80%',
    maxWidth: 320,
    aspectRatio: 4 / 5,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  processingOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  processingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(14,17,23,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  processingPillText: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },
  processingProgressBar: {
    width: '80%',
    maxWidth: 320,
    height: 3,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 16,
  },
  processingProgressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },

  // ── Shared form styles (edit mode) ────────────────────────────────────
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  chipText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },
  timerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timerField: {
    flex: 1,
    gap: 4,
  },
  timerLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  timerInput: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F0F4F8',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FH,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161B22',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  toggleHint: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A3347',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackActive: {
    backgroundColor: 'rgba(245,166,35,0.3)',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A5568',
  },
  toggleThumbActive: {
    backgroundColor: '#F5A623',
    alignSelf: 'flex-end',
  },
  swapSettingsBlock: {
    marginTop: -4,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(167,139,250,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    gap: 10,
  },
  swapSettingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  swapSettingsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  swapSettingsHint: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  swapModePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(167,139,250,0.30)',
    borderWidth: 1,
    borderColor: '#A78BFA',
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapModePillText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '700',
  },
  swapWindowStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swapStepBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapStepBtnText: {
    fontSize: 16,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '700',
    lineHeight: 18,
  },
  swapWindowValue: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  saveBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F5A623',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  autoSaveStatus: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autoSaveText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  doneBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F5A623',
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  mediaAttached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  mediaAttachedText: {
    fontSize: 12,
    color: '#6EBB7A',
    fontFamily: FB,
  },
  reframeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  reframeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },

  // ── No-video create button (upload screen) ───────────────────────────
  noVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  noVideoBtnLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  noVideoBtnHint: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
  },

  // ── Phase 3: Add-Video CTA (edit mode placeholder) ───────────────────
  addVideoCta: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    borderRadius: 12,
    padding: 16,
    gap: 10,
    marginBottom: 8,
  },
  addVideoCtaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  addVideoCtaHint: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 16,
  },
  addVideoCtaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  addVideoCtaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },
  addVideoCtaBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },

  // ── Phase 3: edit-mode processing overlay ─────────────────────────────
  editProcessingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(14,17,23,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  editProcessingText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },

  // ── Phase 3: AI confirm-merge modal ───────────────────────────────────
  aiMergeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  aiMergeSheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  aiMergeHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
    gap: 4,
  },
  aiMergeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  aiMergeSubtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 18,
  },
  aiMergeScroll: {
    flexGrow: 0,
  },
  aiMergeScrollContent: {
    padding: 16,
    gap: 10,
  },
  aiMergeRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  aiMergeRowUnchanged: {
    opacity: 0.6,
  },
  aiMergeCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4A5568',
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  aiMergeCheckboxChecked: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  aiMergeRowBody: {
    flex: 1,
    gap: 6,
  },
  aiMergeRowLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiMergeValues: {
    flexDirection: 'row',
    gap: 10,
  },
  aiMergeValueCol: {
    flex: 1,
    gap: 2,
  },
  aiMergeValueTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4A5568',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiMergeValueTagAi: {
    color: '#F5A623',
  },
  aiMergeValueExisting: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  aiMergeValueProposed: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },
  aiMergeFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  aiMergeSkipBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  aiMergeSkipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  aiMergeApplyBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F5A623',
  },
  aiMergeApplyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  // Phase 4: duplicate-name soft warning banner
  dupWarnBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 166, 35, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.55)',
    gap: 8,
  },
  dupWarnTextWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  dupWarnText: {
    flex: 1,
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    lineHeight: 18,
  },
  dupWarnTextBold: {
    fontWeight: '700',
    color: '#F5A623',
  },
  dupWarnBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dupWarnSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#2A3347',
  },
  dupWarnSaveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  dupWarnRenameBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F5A623',
  },
  dupWarnRenameBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FB,
  },
});
