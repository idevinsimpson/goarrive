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
import { db, storage } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';
import MovementVideoControls from './MovementVideoControls';
import VideoCropModal, { CropValues } from './VideoCropModal';
import { MovementDetailData } from './MovementDetail';
import { generateCroppedGif } from '../utils/generateCroppedGif';
import { generateMovementVoice } from '../utils/generateMovementVoice';
import { analyzeMovementMedia } from '../utils/analyzeMovementMedia';
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

// ── Types ──────────────────────────────────────────────────────────────────
interface MovementFormProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  tenantId: string;
  editMovement?: MovementDetailData | null;
}

type CreateStep = 'upload' | 'crop' | 'processing';

// ── Component ──────────────────────────────────────────────────────────────
export default function MovementForm({
  visible,
  onClose,
  coachId,
  tenantId,
  editMovement,
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
  const [workSec, setWorkSec] = useState('30');
  const [restSec, setRestSec] = useState('15');
  const [countdownSec, setCountdownSec] = useState('3');
  const [swapSides, setSwapSides] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [regression, setRegression] = useState('');
  const [progression, setProgression] = useState('');
  const [contraindications, setContraindications] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── GIF thumbnail generation state ────────────────────────────────────
  const [generatingGif, setGeneratingGif] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const gifPromiseRef = useRef<Promise<string | null> | null>(null);
  const savedDocIdRef = useRef<string | null>(null);

  // ── Crop/reframe state ─────────────────────────────────────────────────
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropScale, setCropScale] = useState(1);
  const [cropTranslateX, setCropTranslateX] = useState(0);
  const [cropTranslateY, setCropTranslateY] = useState(0);

  // ── Pre-populate on edit ───────────────────────────────────────────────
  useEffect(() => {
    if (editMovement) {
      setName(editMovement.name || '');
      setCategory(editMovement.category || '');
      setEquipment(editMovement.equipment || '');
      setDifficulty(editMovement.difficulty || '');
      setDescription(editMovement.description || '');
      setMuscleGroups(editMovement.muscleGroups || []);
      setWorkSec(String(editMovement.workSec ?? 30));
      setRestSec(String(editMovement.restSec ?? 15));
      setCountdownSec(String(editMovement.countdownSec ?? 3));
      setSwapSides(editMovement.swapSides ?? false);
      setVideoUrl((editMovement as any).videoUrl || editMovement.mediaUrl || '');
      setThumbnailUrl((editMovement as any).thumbnailUrl || '');
      setRegression((editMovement as any).regression || '');
      setProgression((editMovement as any).progression || '');
      setContraindications((editMovement as any).contraindications || '');
      setCropScale((editMovement as any).cropScale ?? 1);
      setCropTranslateX((editMovement as any).cropTranslateX ?? 0);
      setCropTranslateY((editMovement as any).cropTranslateY ?? 0);
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
    setShowCropModal(false);
    setGeneratingGif(false);
    setGifProgress(0);
    gifPromiseRef.current = null;
    savedDocIdRef.current = null;
  };

  // ── GIF thumbnail generation ─────────────────────────────────────────
  const generateAndUploadGif = useCallback(
    (url: string, crop: CropValues): Promise<string | null> => {
      if (Platform.OS !== 'web' || !url) return Promise.resolve(null);

      setGeneratingGif(true);
      setGifProgress(0);

      const promise = (async (): Promise<string | null> => {
        try {
          const blob = await generateCroppedGif(url, crop, (p) => {
            setGifProgress(p);
          });

          if (!blob) {
            console.warn('[MovementForm] GIF generation returned null');
            setGeneratingGif(false);
            return null;
          }

          // Upload the GIF to Firebase Storage
          const fileName = `movements/${coachId}/thumbnails/${Date.now()}.gif`;
          const storageRef = ref(storage, fileName);
          const uploadTask = uploadBytesResumable(storageRef, blob, {
            contentType: 'image/gif',
          });

          const downloadUrl = await new Promise<string>((resolve, reject) => {
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                const uploadPct = snapshot.bytesTransferred / snapshot.totalBytes;
                setGifProgress(0.9 + uploadPct * 0.1);
              },
              (error) => reject(error),
              async () => {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(url);
              },
            );
          });

          setThumbnailUrl(downloadUrl);
          setGeneratingGif(false);
          setGifProgress(0);

          // If the form was already saved, auto-patch the Firestore document
          if (savedDocIdRef.current) {
            try {
              await updateDoc(doc(db, 'movements', savedDocIdRef.current), {
                thumbnailUrl: downloadUrl,
              });
            } catch (patchErr) {
              console.error('[MovementForm] Auto-patch thumbnailUrl error:', patchErr);
            }
          }

          return downloadUrl;
        } catch (err) {
          console.error('[MovementForm] GIF generation error:', err);
          setGeneratingGif(false);
          setGifProgress(0);
          return null;
        }
      })();

      gifPromiseRef.current = promise;
      return promise;
    },
    [coachId],
  );

  // ── Media upload (shared by Library and Camera) ──────────────────────
  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const isVideo = asset.type === 'video';
    const ext = isVideo ? 'mp4' : 'jpg';
    const folder = isVideo ? 'videos' : 'thumbnails';
    const fileName = `movements/${coachId}/${folder}/${Date.now()}.${ext}`;

    setUploading(true);
    setUploadProgress(0);

    const response = await fetch(asset.uri);
    const blob = await response.blob();

    const storageRef = ref(storage, fileName);
    const uploadTask = uploadBytesResumable(storageRef, blob, {
      contentType: isVideo ? 'video/mp4' : 'image/jpeg',
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

  // ── Pick from library ────────────────────────────────────────────────
  const pickFromLibrary = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant media library access to upload videos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 25,
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
    setShowCropModal(false);
    setCreateStep('processing');

    try {
      // Step 1: Start GIF thumbnail generation + AI analysis in parallel
      setProcessingStatus('Analyzing movement...');
      setProcessingProgress(0.1);

      // GIF generation (for thumbnail display) runs alongside AI analysis
      const gifPromise = generateAndUploadGif(videoUrl, crop);

      // AI analysis uses a lightweight contact sheet (12 frames) instead of the full GIF
      let aiData: Record<string, any> = {};
      try {
        setProcessingProgress(0.2);
        const analysis = await analyzeMovementMedia(videoUrl, crop);
        if (analysis) {
          aiData = {
            name: analysis.name || '',
            category: analysis.category || '',
            equipment: analysis.equipment || '',
            difficulty: analysis.difficulty || '',
            muscleGroups: analysis.muscleGroups || [],
            description: analysis.description || '',
            regression: analysis.regression || '',
            progression: analysis.progression || '',
            contraindications: analysis.contraindications || '',
            workSec: analysis.workSec || 30,
            restSec: analysis.restSec || 15,
          };
        }
      } catch (aiErr) {
        console.warn('[MovementForm] AI analysis failed, saving without:', aiErr);
      }

      setProcessingProgress(0.5);
      setProcessingStatus('Creating thumbnail...');

      // Wait for GIF to finish (may already be done)
      const gifUrl = await gifPromise;

      setProcessingProgress(0.7);
      setProcessingStatus('Saving movement...');

      // Step 3: Save to Firestore
      const data: Record<string, any> = {
        name: aiData.name || 'New Movement',
        category: aiData.category || '',
        equipment: aiData.equipment || '',
        difficulty: aiData.difficulty || '',
        description: aiData.description || '',
        muscleGroups: aiData.muscleGroups || [],
        workSec: aiData.workSec || 30,
        restSec: aiData.restSec || 15,
        countdownSec: 3,
        swapSides: false,
        swapMode: 'split' as const,
        swapWindowSec: 5,
        videoUrl: videoUrl.trim(),
        thumbnailUrl: gifUrl || '',
        regression: aiData.regression || '',
        progression: aiData.progression || '',
        contraindications: aiData.contraindications || '',
        cropScale: crop.cropScale,
        cropTranslateX: crop.cropTranslateX,
        cropTranslateY: crop.cropTranslateY,
        coachId,
        tenantId,
        isGlobal: false,
        isArchived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'movements'), data);
      const docId = docRef.id;
      savedDocIdRef.current = docId;

      setProcessingProgress(0.85);

      // Step 4: Voice generation (non-blocking)
      if (aiData.name) {
        setProcessingStatus('Generating voice...');
        generateMovementVoice(docId, aiData.name)
          .then((voiceUrl) => {
            if (voiceUrl) {
              updateDoc(doc(db, 'movements', docId), { voiceUrl }).catch(() => {});
            }
          })
          .catch(() => {});
      }

      setProcessingProgress(1);
      setProcessingStatus('Done!');

      // Brief pause to show completion, then close
      setTimeout(() => {
        resetForm();
        onClose();
      }, 600);
    } catch (err) {
      console.error('[MovementForm] Processing pipeline error:', err);
      Alert.alert('Error', 'Something went wrong while creating the movement. Please try again.');
      setCreateStep('upload');
      setProcessingStatus('');
      setProcessingProgress(0);
    }
  };

  // ── Muscle group toggle (for edit mode) ───────────────────────────────
  const toggleMuscleGroup = (mg: string) => {
    setMuscleGroups((prev) =>
      prev.includes(mg) ? prev.filter((g) => g !== mg) : [...prev, mg],
    );
  };

  // ── Edit mode submit ──────────────────────────────────────────────────
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
        muscleGroups,
        workSec: parseInt(workSec, 10) || 30,
        restSec: parseInt(restSec, 10) || 15,
        countdownSec: parseInt(countdownSec, 10) || 3,
        swapSides,
        swapMode: 'split' as const,
        swapWindowSec: 5,
        videoUrl: videoUrl.trim(),
        thumbnailUrl: finalThumbnailUrl,
        regression: regression.trim(),
        progression: progression.trim(),
        contraindications: contraindications.trim(),
        cropScale,
        cropTranslateX,
        cropTranslateY,
        updatedAt: serverTimestamp(),
      };

      const docId = editMovement!.id;
      await updateDoc(doc(db, 'movements', docId), data);
      savedDocIdRef.current = docId;

      // Regenerate voice if name changed
      const prevName = editMovement?.name?.trim() ?? null;
      const newName = name.trim();
      if (prevName !== newName) {
        generateMovementVoice(docId, newName)
          .then((voiceUrl) => {
            if (voiceUrl) {
              updateDoc(doc(db, 'movements', docId), { voiceUrl }).catch(() => {});
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
        <Modal visible={visible} animationType="slide" transparent={true}>
          <View style={st.overlay}>
            <View style={st.sheet}>
              <View style={st.header}>
                <Text style={st.headerTitle}>Edit Movement</Text>
                <Pressable onPress={onClose} hitSlop={8}>
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
                  style={st.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Back Squat"
                  placeholderTextColor="#4A5568"
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

                {/* Media */}
                <Text style={st.sectionTitle}>Media</Text>
                {videoUrl ? (
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
                ) : null}

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

              {/* Footer */}
              <View style={st.footer}>
                <Pressable style={st.cancelBtn} onPress={onClose}>
                  <Text style={st.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[st.saveBtn, submitting && st.saveBtnDisabled]}
                  onPress={handleEditSubmit}
                  disabled={submitting}
                >
                  <Text style={st.saveBtnText}>
                    {submitting ? 'Saving...' : 'Save Changes'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <VideoCropModal
          visible={showCropModal}
          videoUri={videoUrl}
          initialCrop={{ cropScale, cropTranslateX, cropTranslateY }}
          onDone={(crop: CropValues) => {
            setCropScale(crop.cropScale);
            setCropTranslateX(crop.cropTranslateX);
            setCropTranslateY(crop.cropTranslateY);
            setShowCropModal(false);
            generateAndUploadGif(videoUrl, crop);
          }}
          onCancel={() => setShowCropModal(false)}
        />
      </>
    );
  }

  // ── CREATE MODE: Simplified 3-step flow ────────────────────────────────
  return (
    <>
      <Modal visible={visible} animationType="slide" transparent={true}>
        <View style={st.overlay}>
          <View style={st.createSheet}>
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
                  Upload or record a movement demo (up to 25 sec)
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
          </View>
        </View>
      </Modal>

      {/* Crop Modal — rendered OUTSIDE so it layers on top on iOS */}
      <VideoCropModal
        visible={showCropModal}
        videoUri={videoUrl}
        initialCrop={{ cropScale, cropTranslateX, cropTranslateY }}
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

// ── Styles ────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },

  // ── Edit mode sheet (same as before) ─────────────────────────────────
  sheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    overflow: 'hidden' as const,
    borderTopRightRadius: 20,
    height: '90%',
  },
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
    gap: 16,
  },

  // ── Create mode sheet ─────────────────────────────────────────────────
  createSheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '92%',
    overflow: 'hidden' as const,
  },
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
});
