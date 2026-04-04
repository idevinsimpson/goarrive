/**
 * BulkMovementUpload — Multi-video movement upload with auto-processing
 *
 * Allows coaches to select multiple videos at once. Each video is automatically:
 *   1. Uploaded to Firebase Storage
 *   2. Auto-cropped to 4:5 center (default crop)
 *   3. GIF thumbnail generated
 *   4. Sent to ChatGPT for AI analysis (name, category, equipment, etc.)
 *   5. Saved to Firestore as a movement
 *   6. Voice generated for the movement name
 *
 * Shows a progress card for each video being processed.
 * Coach can edit individual movements later to adjust crop/metadata.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
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
import { generateCroppedGif } from '../utils/generateCroppedGif';
import { generateMovementVoice } from '../utils/generateMovementVoice';
import { analyzeMovementMedia } from '../utils/analyzeMovementMedia';
import { FB, FH } from '../lib/theme';

// ── Constants ──────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────────────
type UploadStatus = 'queued' | 'uploading' | 'generating_gif' | 'analyzing' | 'saving' | 'voice' | 'done' | 'error';

interface UploadItem {
  id: string;
  fileName: string;
  asset: ImagePicker.ImagePickerAsset;
  status: UploadStatus;
  progress: number; // 0-1
  statusText: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  movementName?: string;
  error?: string;
}

interface BulkMovementUploadProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  tenantId: string;
}

// ── Status labels ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<UploadStatus, string> = {
  queued: 'Waiting...',
  uploading: 'Uploading video...',
  generating_gif: 'Creating thumbnail...',
  analyzing: 'AI analyzing movement...',
  saving: 'Saving movement...',
  voice: 'Generating voice...',
  done: 'Complete!',
  error: 'Failed',
};

// ── Component ──────────────────────────────────────────────────────────────
export default function BulkMovementUpload({
  visible,
  onClose,
  coachId,
  tenantId,
}: BulkMovementUploadProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);

  // ── Update a single item ───────────────────────────────────────────────
  const updateItem = useCallback((id: string, updates: Partial<UploadItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }, []);

  // ── Pick multiple videos ───────────────────────────────────────────────
  const pickVideos = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant media library access to upload videos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: true,
        quality: 0.8,
        videoMaxDuration: 25,
      });

      if (result.canceled || !result.assets?.length) return;

      const newItems: UploadItem[] = result.assets.map((asset, idx) => ({
        id: `${Date.now()}-${idx}`,
        fileName: asset.fileName || `video_${idx + 1}.mp4`,
        asset,
        status: 'queued' as UploadStatus,
        progress: 0,
        statusText: 'Waiting...',
      }));

      setItems(prev => [...prev, ...newItems]);
    } catch (err) {
      console.error('[BulkUpload] Pick videos error:', err);
    }
  };

  // ── Upload a single video to Firebase Storage ──────────────────────────
  const uploadVideo = async (item: UploadItem): Promise<string> => {
    const fileName = `movements/${coachId}/videos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const response = await fetch(item.asset.uri);
    const blob = await response.blob();
    const storageRef = ref(storage, fileName);
    const uploadTask = uploadBytesResumable(storageRef, blob, {
      contentType: 'video/mp4',
    });

    return new Promise<string>((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.bytesTransferred / snapshot.totalBytes;
          updateItem(item.id, { progress: progress * 0.3, statusText: `Uploading... ${Math.round(progress * 100)}%` });
        },
        (error) => reject(error),
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(downloadUrl);
        },
      );
    });
  };

  // ── Process a single item through the full pipeline ────────────────────
  const processItem = async (item: UploadItem) => {
    try {
      // Step 1: Upload video
      updateItem(item.id, { status: 'uploading', statusText: 'Uploading video...', progress: 0 });
      const videoUrl = await uploadVideo(item);
      updateItem(item.id, { videoUrl, progress: 0.3 });

      // Step 2: Generate GIF (auto-crop to center, default 4:5)
      let gifUrl: string | null = null;
      if (Platform.OS === 'web') {
        updateItem(item.id, { status: 'generating_gif', statusText: 'Creating thumbnail...', progress: 0.3 });
        try {
          const defaultCrop = { cropScale: 1, cropTranslateX: 0, cropTranslateY: 0 };
          const gifBlob = await generateCroppedGif(videoUrl, defaultCrop, (p) => {
            updateItem(item.id, { progress: 0.3 + p * 0.2 });
          });

          if (gifBlob) {
            const gifFileName = `movements/${coachId}/thumbnails/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.gif`;
            const gifRef = ref(storage, gifFileName);
            const gifUploadTask = uploadBytesResumable(gifRef, gifBlob, { contentType: 'image/gif' });

            gifUrl = await new Promise<string>((resolve, reject) => {
              gifUploadTask.on(
                'state_changed',
                () => {},
                (error) => reject(error),
                async () => {
                  const url = await getDownloadURL(gifUploadTask.snapshot.ref);
                  resolve(url);
                },
              );
            });

            updateItem(item.id, { thumbnailUrl: gifUrl, progress: 0.5 });
          }
        } catch (gifErr) {
          console.warn('[BulkUpload] GIF generation failed for', item.fileName, gifErr);
        }
      }

      // Step 3: AI Analysis
      let aiData: Record<string, any> = {};
      if (gifUrl) {
        updateItem(item.id, { status: 'analyzing', statusText: 'AI analyzing movement...', progress: 0.5 });
        try {
          const analysis = await analyzeMovementMedia(gifUrl);
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
          console.warn('[BulkUpload] AI analysis failed for', item.fileName, aiErr);
        }
      }

      updateItem(item.id, {
        movementName: aiData.name || 'New Movement',
        progress: 0.7,
      });

      // Step 4: Save to Firestore
      updateItem(item.id, { status: 'saving', statusText: 'Saving movement...', progress: 0.7 });

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
        cropScale: 1,
        cropTranslateX: 0,
        cropTranslateY: 0,
        coachId,
        tenantId,
        isGlobal: false,
        isArchived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'movements'), data);
      const docId = docRef.id;

      updateItem(item.id, { progress: 0.85 });

      // Step 5: Voice generation (non-blocking)
      if (aiData.name) {
        updateItem(item.id, { status: 'voice', statusText: 'Generating voice...', progress: 0.85 });
        try {
          const voiceUrl = await generateMovementVoice(docId, aiData.name);
          if (voiceUrl) {
            await updateDoc(doc(db, 'movements', docId), { voiceUrl });
          }
        } catch (voiceErr) {
          console.warn('[BulkUpload] Voice generation failed for', item.fileName, voiceErr);
        }
      }

      // Done!
      updateItem(item.id, {
        status: 'done',
        statusText: `Done! → ${aiData.name || 'New Movement'}`,
        progress: 1,
      });
    } catch (err: any) {
      console.error('[BulkUpload] Pipeline error for', item.fileName, err);
      updateItem(item.id, {
        status: 'error',
        statusText: `Error: ${err.message || 'Unknown error'}`,
        error: err.message || 'Unknown error',
      });
    }
  };

  // ── Start processing all queued items ──────────────────────────────────
  // Process 2 at a time to avoid overwhelming the browser
  const startProcessing = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    const queued = items.filter(i => i.status === 'queued');
    const CONCURRENCY = 2;

    // Process in batches of CONCURRENCY
    for (let i = 0; i < queued.length; i += CONCURRENCY) {
      const batch = queued.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(item => processItem(item)));
    }

    processingRef.current = false;
    setIsProcessing(false);
  };

  // ── Remove an item ─────────────────────────────────────────────────────
  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // ── Close and reset ────────────────────────────────────────────────────
  const handleClose = () => {
    if (isProcessing) {
      Alert.alert('Processing in Progress', 'Videos are still being processed. Are you sure you want to close?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Anyway', style: 'destructive', onPress: () => { setItems([]); onClose(); } },
      ]);
    } else {
      setItems([]);
      onClose();
    }
  };

  const queuedCount = items.filter(i => i.status === 'queued').length;
  const doneCount = items.filter(i => i.status === 'done').length;
  const errorCount = items.filter(i => i.status === 'error').length;
  const processingCount = items.filter(i => !['queued', 'done', 'error'].includes(i.status)).length;

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={handleClose} style={s.backBtn}>
            <Icon name="chevron-left" size={22} color="#F0F4F8" />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.title}>Bulk Upload</Text>
          <View style={{ width: 80 }} />
        </View>

        {/* Summary bar */}
        {items.length > 0 && (
          <View style={s.summaryBar}>
            <Text style={s.summaryText}>
              {doneCount}/{items.length} complete
              {errorCount > 0 ? ` · ${errorCount} failed` : ''}
              {processingCount > 0 ? ` · ${processingCount} processing` : ''}
            </Text>
          </View>
        )}

        {/* Content */}
        <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
          {items.length === 0 ? (
            <View style={s.emptyState}>
              <Icon name="movements" size={48} color="#4A5568" />
              <Text style={s.emptyTitle}>Select Videos to Upload</Text>
              <Text style={s.emptyDesc}>
                Choose multiple movement videos at once.{'\n'}
                Each will be auto-cropped, analyzed by AI,{'\n'}
                and saved as a movement with all metadata filled in.
              </Text>
            </View>
          ) : (
            items.map((item) => (
              <View key={item.id} style={s.itemCard}>
                {/* Thumbnail or placeholder */}
                <View style={s.itemThumb}>
                  {item.thumbnailUrl ? (
                    <Image source={{ uri: item.thumbnailUrl }} style={s.itemThumbImage} resizeMode="cover" />
                  ) : (
                    <View style={s.itemThumbPlaceholder}>
                      {item.status === 'done' ? (
                        <Icon name="check" size={20} color="#22C55E" />
                      ) : item.status === 'error' ? (
                        <Icon name="x" size={20} color="#EF4444" />
                      ) : (
                        <ActivityIndicator size="small" color="#F5A623" />
                      )}
                    </View>
                  )}
                </View>

                {/* Info */}
                <View style={s.itemInfo}>
                  <Text style={s.itemName} numberOfLines={1}>
                    {item.movementName || item.fileName}
                  </Text>
                  <Text style={[s.itemStatus, item.status === 'done' && s.itemStatusDone, item.status === 'error' && s.itemStatusError]}>
                    {item.statusText}
                  </Text>

                  {/* Progress bar */}
                  {item.status !== 'done' && item.status !== 'error' && item.status !== 'queued' && (
                    <View style={s.progressBar}>
                      <View style={[s.progressFill, { width: `${Math.round(item.progress * 100)}%` }]} />
                    </View>
                  )}
                </View>

                {/* Remove button (only for queued or errored items) */}
                {(item.status === 'queued' || item.status === 'error') && (
                  <Pressable onPress={() => removeItem(item.id)} style={s.removeBtn}>
                    <Icon name="x" size={16} color="#94A3B8" />
                  </Pressable>
                )}
              </View>
            ))
          )}
        </ScrollView>

        {/* Action buttons */}
        <View style={s.footer}>
          <Pressable style={s.addBtn} onPress={pickVideos} disabled={isProcessing}>
            <Icon name="add" size={18} color="#F0F4F8" />
            <Text style={s.addBtnText}>
              {items.length === 0 ? 'Select Videos' : 'Add More Videos'}
            </Text>
          </Pressable>

          {queuedCount > 0 && !isProcessing && (
            <Pressable style={s.processBtn} onPress={startProcessing}>
              <Icon name="movements" size={18} color="#0E1117" />
              <Text style={s.processBtnText}>
                Process {queuedCount} Video{queuedCount !== 1 ? 's' : ''}
              </Text>
            </Pressable>
          )}

          {isProcessing && (
            <View style={s.processingIndicator}>
              <ActivityIndicator size="small" color="#F5A623" />
              <Text style={s.processingText}>Processing...</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'web' ? 16 : 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 80,
  },
  backText: {
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  title: {
    fontSize: 18,
    fontFamily: FH,
    color: '#F0F4F8',
    fontWeight: '700',
  },
  summaryBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1A2332',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  summaryText: {
    fontSize: 13,
    color: '#94A3B8',
    fontFamily: FB,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: FH,
    color: '#F0F4F8',
    fontWeight: '700',
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: FB,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A2332',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  itemThumb: {
    width: 48,
    height: 60,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#0E1117',
  },
  itemThumbImage: {
    width: 48,
    height: 60,
  },
  itemThumbPlaceholder: {
    width: 48,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  itemName: {
    fontSize: 14,
    fontFamily: FH,
    color: '#F0F4F8',
    fontWeight: '600',
  },
  itemStatus: {
    fontSize: 12,
    fontFamily: FB,
    color: '#94A3B8',
  },
  itemStatusDone: {
    color: '#22C55E',
  },
  itemStatusError: {
    color: '#EF4444',
  },
  progressBar: {
    height: 3,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  removeBtn: {
    padding: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'web' ? 16 : 34,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    gap: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A2332',
    borderRadius: 10,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#2D3748',
    borderStyle: 'dashed',
  },
  addBtnText: {
    fontSize: 15,
    fontFamily: FB,
    color: '#F0F4F8',
  },
  processBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 14,
  },
  processBtnText: {
    fontSize: 15,
    fontFamily: FH,
    color: '#0E1117',
    fontWeight: '700',
  },
  processingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  processingText: {
    fontSize: 14,
    fontFamily: FB,
    color: '#F5A623',
  },
});
