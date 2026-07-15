/**
 * MovementVariationModal — AI "Build variation" flow
 *
 * Coach opens an existing movement, describes the change they want, previews
 * AI-generated (Runway) video options, picks one, and a brand-new movement is
 * created through the exact same processing pipeline as an uploaded video
 * (crop → GIFs → poster → AI analysis → doc → voice → one-rep loop).
 * The source movement is never modified.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Icon } from './Icon';
import MovementVideoControls from './MovementVideoControls';
import VideoCropModal, { CropValues } from './VideoCropModal';
import { MovementDetailData } from './MovementDetail';
import { createMovementFromVideo } from '../utils/createMovementFromVideo';
import { FB, FH } from '../lib/theme';

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_PROMPT_CHARS = 600;
const POLL_INTERVAL_MS = 5000;
const VARIATION_PROVIDER = 'runway';
const VARIATION_MODEL = 'aleph2';

// Default crop for AI-generated videos (full frame, standard 4:5 movement frame)
const DEFAULT_VARIATION_CROP = {
  cropScale: 1,
  cropTranslateX: 0,
  cropTranslateY: 0,
  cropFrameWidth: 345,
  cropFrameHeight: 431,
};

const QUICK_PROMPTS = [
  'Make it lower impact',
  'Make it beginner friendly',
  'Change running to walking',
  'Remove jumping',
  'Make it bodyweight',
  'Make it slower and controlled',
];

const ERR_NO_VIDEO = 'This movement needs a video before AI can build a variation.';
const ERR_GENERATION_FAILED = 'Generation failed. Try a simpler instruction or record a short version manually.';
const MSG_PATIENCE = 'This can take a bit. Feel free to close this — we keep building in the background and the movement card will show "Remix ready" when previews are done.';

// ── Types ───────────────────────────────────────────────────────────────────

interface VariationCandidate {
  id: string;
  status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress: number;
  videoUrl: string | null;
  /** Durable Storage copy written by the background poller — outlives the Runway URL. */
  storedVideoUrl?: string | null;
  error: string | null;
}

function candidatePlaybackUrl(c: VariationCandidate): string | null {
  return c.storedVideoUrl || c.videoUrl || null;
}

interface StatusResponse {
  jobId: string;
  status: string;
  errorMessage: string | null;
  candidates: VariationCandidate[];
}

type Phase = 'compose' | 'generating' | 'choose' | 'cropping' | 'creating';

interface Props {
  visible: boolean;
  sourceMovement: MovementDetailData | null;
  coachId: string;
  tenantId: string;
  onClose: () => void;
  /** Called with the new movement after creation so the caller can open its detail */
  onCreated?: (movementId: string, movementData: Record<string, any>) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function MovementVariationModal({
  visible,
  sourceMovement,
  coachId,
  tenantId,
  onClose,
  onCreated,
}: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('compose');
  const [instruction, setInstruction] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VariationCandidate[]>([]);
  const [pendingCandidate, setPendingCandidate] = useState<VariationCandidate | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creatingStatus, setCreatingStatus] = useState('');
  const [creatingProgress, setCreatingProgress] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closedRef = useRef(false);

  const resetState = useCallback(() => {
    setPhase('compose');
    setInstruction('');
    setJobId(null);
    setCandidates([]);
    setErrorMsg(null);
    setCreatingStatus('');
    setCreatingProgress(0);
  }, []);

  useEffect(() => () => {
    closedRef.current = true;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async (activeJobId: string) => {
    try {
      const functions = getFunctions(undefined, 'us-central1');
      const getStatus = httpsCallable<{ jobId: string }, StatusResponse>(
        functions,
        'getMovementVariationStatus',
      );
      const result = await getStatus({ jobId: activeJobId });
      if (closedRef.current) return;
      const data = result.data;
      setCandidates(data.candidates || []);
      if (data.status === 'succeeded') {
        stopPolling();
        setPhase('choose');
      } else if (data.status === 'failed') {
        stopPolling();
        setErrorMsg(ERR_GENERATION_FAILED);
        setPhase('compose');
      }
    } catch (err) {
      // Transient poll error — keep polling; the next tick may succeed.
      console.warn('[MovementVariationModal] Status poll failed:', err);
    }
  }, [stopPolling]);

  // On open, look for the newest unfinalized job for this movement (running or
  // ready to review) and resume it — closing the modal no longer orphans a job.
  const resumeExistingJob = useCallback(async () => {
    if (!sourceMovement || !coachId) return;
    try {
      const snap = await getDocs(query(
        collection(db, 'movement_variation_jobs'),
        where('coachId', '==', coachId),
        where('sourceMovementId', '==', sourceMovement.id),
        where('status', 'in', ['running', 'succeeded']),
      ));
      if (closedRef.current) return;
      const jobs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((j) => !j.finalizedVideoUrl)
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      const job = jobs[0];
      if (!job) return;
      setJobId(job.id);
      setInstruction(job.instruction || '');
      setCandidates(Array.isArray(job.candidates) ? job.candidates : []);
      if (job.status === 'succeeded') {
        setPhase('choose');
      } else {
        setPhase('generating');
        stopPolling();
        pollTimerRef.current = setInterval(() => pollStatus(job.id), POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.warn('[MovementVariationModal] Resume check failed:', err);
    }
  }, [sourceMovement, coachId, pollStatus, stopPolling]);

  useEffect(() => {
    if (visible) {
      closedRef.current = false;
      resetState();
      resumeExistingJob();
    } else {
      closedRef.current = true;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, resetState]);

  const handleGenerate = useCallback(async () => {
    if (!sourceMovement) return;
    if (!sourceMovement.videoUrl) {
      setErrorMsg(ERR_NO_VIDEO);
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) return;

    setErrorMsg(null);
    setPhase('generating');
    setCandidates([]);
    try {
      const functions = getFunctions(undefined, 'us-central1');
      // Server transcodes + trims the source video before responding, which can
      // exceed the SDK's default 70s callable timeout — match the function's 180s.
      const start = httpsCallable<
        { sourceMovementId: string; instruction: string; outputCount?: number },
        { jobId: string; candidateCount: number }
      >(functions, 'startMovementVariation', { timeout: 180000 });
      const result = await start({
        sourceMovementId: sourceMovement.id,
        instruction: trimmed,
        outputCount: 2,
      });
      if (closedRef.current) return;
      const newJobId = result.data.jobId;
      setJobId(newJobId);
      stopPolling();
      pollTimerRef.current = setInterval(() => pollStatus(newJobId), POLL_INTERVAL_MS);
    } catch (err: any) {
      console.error('[MovementVariationModal] Start failed:', err);
      if (closedRef.current) return;
      const code = err?.code || '';
      setErrorMsg(
        String(code).includes('failed-precondition') ? ERR_NO_VIDEO : ERR_GENERATION_FAILED,
      );
      setPhase('compose');
    }
  }, [sourceMovement, instruction, pollStatus, stopPolling]);

  // Called after the coach picks a candidate — shows crop modal first.
  const handleSelectCandidate = useCallback((candidate: VariationCandidate) => {
    setPendingCandidate(candidate);
    setShowCropModal(true);
    setPhase('cropping');
  }, []);

  // Called after crop is confirmed (or cancelled back to choose).
  const handleCropDone = useCallback(async (crop: CropValues) => {
    setShowCropModal(false);
    const candidate = pendingCandidate;
    if (!candidate || !sourceMovement || !jobId) return;
    setPhase('creating');
    setErrorMsg(null);
    setCreatingStatus('Saving your new video...');
    setCreatingProgress(0.05);
    try {
      // 1. Finalize: server downloads the Runway output and persists it to Storage.
      const functions = getFunctions(undefined, 'us-central1');
      const finalize = httpsCallable<
        { jobId: string; candidateId: string },
        { videoUrl: string; sourceMovementId: string; sourceMovementName: string; instruction: string; jobId: string }
      >(functions, 'finalizeMovementVariation', { timeout: 300000 });
      const finalized = await finalize({ jobId, candidateId: candidate.id });
      if (closedRef.current) return;

      // 2. Full movement processing pipeline — same as an uploaded video.
      const { movementId, movementData } = await createMovementFromVideo({
        videoUrl: finalized.data.videoUrl,
        crop,
        coachId,
        tenantId,
        metadata: {
          createdVia: 'ai_variation',
          sourceMovementId: sourceMovement.id,
          sourceMovementName: sourceMovement.name,
          aiVariationPrompt: finalized.data.instruction,
          aiVariationJobId: jobId,
          aiVariationProvider: VARIATION_PROVIDER,
          aiVariationModel: VARIATION_MODEL,
        },
        onStatus: (s) => { if (!closedRef.current) setCreatingStatus(s); },
        onProgress: (p) => { if (!closedRef.current) setCreatingProgress(p); },
      });
      if (closedRef.current) return;
      onCreated?.(movementId, movementData);
      onClose();
    } catch (err) {
      console.error('[MovementVariationModal] Finalize/create failed:', err);
      if (closedRef.current) return;
      setErrorMsg(ERR_GENERATION_FAILED);
      setPhase('choose');
    }
  }, [pendingCandidate, sourceMovement, jobId, coachId, tenantId, onCreated, onClose]);

  const handleCropCancel = useCallback(() => {
    setShowCropModal(false);
    setPendingCandidate(null);
    setPhase('choose');
  }, []);

  if (!sourceMovement) return null;

  // Card width: two cards side-by-side with 16px horizontal padding + 8px gap
  const cardWidth = (windowWidth - 32 - 8) / 2;
  const cardVideoHeight = cardWidth * (5 / 4); // 4:5 aspect

  const trimmedLen = instruction.trim().length;
  const generateDisabled = trimmedLen === 0 || phase === 'generating' || phase === 'creating';
  const succeededCandidates = candidates.filter((c) => c.status === 'SUCCEEDED' && candidatePlaybackUrl(c));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, Platform.OS === 'web' && { height: windowHeight }]}>
        {/* Header */}
        <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="close" size={24} color="#8A95A3" />
          </Pressable>
          <Text style={s.headerTitle}>Build Variation</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { paddingBottom: 24 + insets.bottom }]}>
          {/* Source movement */}
          <View style={s.sourceRow}>
            <Icon name="sparkle" size={16} color="#A78BFA" />
            <Text style={s.sourceLabel}>Based on</Text>
            <Text style={s.sourceName} numberOfLines={1}>{sourceMovement.name}</Text>
          </View>
          {sourceMovement.videoUrl ? (
            <View style={s.mediaSection}>
              <MovementVideoControls
                uri={sourceMovement.videoUrl}
                posterUri={sourceMovement.thumbnailUrl || undefined}
                aspectRatio={4 / 5}
                autoPlay={phase !== 'creating'}
                showControls={true}
                cropScale={sourceMovement.cropScale ?? 1}
                cropTranslateX={sourceMovement.cropTranslateX ?? 0}
                cropTranslateY={sourceMovement.cropTranslateY ?? 0}
              />
            </View>
          ) : (
            <Text style={s.errorText}>{ERR_NO_VIDEO}</Text>
          )}

          {/* Error banner */}
          {errorMsg ? (
            <View style={s.errorBanner}>
              <Icon name="warning" size={16} color="#E05252" />
              <Text style={s.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          {(phase === 'compose' || phase === 'generating') && (
            <>
              {/* Instruction input */}
              <Text style={s.sectionLabel}>What should change?</Text>
              <TextInput
                style={s.input}
                value={instruction}
                onChangeText={(t) => setInstruction(t.slice(0, MAX_PROMPT_CHARS))}
                placeholder="e.g. Change the jump squat into a slow bodyweight squat"
                placeholderTextColor="#5B6472"
                multiline
                maxLength={MAX_PROMPT_CHARS}
                editable={phase === 'compose'}
              />
              <Text style={s.charCount}>{instruction.length}/{MAX_PROMPT_CHARS}</Text>

              {/* Quick prompt chips */}
              <View style={s.chipRow}>
                {QUICK_PROMPTS.map((p) => (
                  <Pressable
                    key={p}
                    style={[s.chip, instruction === p && s.chipActive]}
                    onPress={() => phase === 'compose' && setInstruction(p)}
                  >
                    <Text style={[s.chipText, instruction === p && s.chipTextActive]}>{p}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Generate CTA */}
              <Pressable
                style={[s.generateBtn, generateDisabled && s.generateBtnDisabled]}
                onPress={handleGenerate}
                disabled={generateDisabled}
              >
                {phase === 'generating' ? (
                  <ActivityIndicator size="small" color="#0E1117" />
                ) : (
                  <Icon name="sparkle" size={18} color="#0E1117" />
                )}
                <Text style={s.generateText}>
                  {phase === 'generating' ? 'Generating previews…' : 'Generate variations'}
                </Text>
              </Pressable>

              {phase === 'generating' && (
                <View style={s.progressNote}>
                  <ActivityIndicator size="small" color="#A78BFA" />
                  <Text style={s.progressNoteText}>{MSG_PATIENCE}</Text>
                </View>
              )}
            </>
          )}

          {(phase === 'choose' || phase === 'cropping') && (
            <>
              <Text style={s.sectionLabel}>Choose a version</Text>
              <Text style={s.instructionRecap} numberOfLines={2}>"{instruction.trim()}"</Text>
              {succeededCandidates.length === 0 ? (
                <Text style={s.errorText}>{ERR_GENERATION_FAILED}</Text>
              ) : (
                <View style={s.candidatesRow}>
                  {succeededCandidates.map((c, idx) => (
                    <View key={c.id} style={[s.candidateCard, { width: cardWidth }]}>
                      <Text style={s.candidateLabel}>Option {idx + 1}</Text>
                      <View style={[s.candidateVideoWrap, { height: cardVideoHeight }]}>
                        <MovementVideoControls
                          uri={candidatePlaybackUrl(c)!}
                          aspectRatio={4 / 5}
                          autoPlay={true}
                          showControls={false}
                        />
                      </View>
                      <Pressable style={s.selectBtn} onPress={() => handleSelectCandidate(c)}>
                        <Icon name="check" size={14} color="#0E1117" />
                        <Text style={s.selectText}>Select</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Pressable style={s.tryAgainBtn} onPress={() => { setPhase('compose'); setCandidates([]); }}>
                <Text style={s.tryAgainText}>Try a different instruction</Text>
              </Pressable>
            </>
          )}

          {phase === 'creating' && (
            <View style={s.creatingBox}>
              <ActivityIndicator size="large" color="#A78BFA" />
              <Text style={s.creatingStatus}>{creatingStatus || 'Creating your new movement…'}</Text>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${Math.round(creatingProgress * 100)}%` }]} />
              </View>
              <Text style={s.progressNoteText}>{MSG_PATIENCE}</Text>
            </View>
          )}

          {/* Disclaimer */}
          <Text style={s.disclaimer}>AI variations should be reviewed before assigning to clients.</Text>
        </ScrollView>
      </View>

      {/* Crop modal — shown after coach selects a variation candidate */}
      {pendingCandidate && candidatePlaybackUrl(pendingCandidate) ? (
        <VideoCropModal
          visible={showCropModal}
          videoUri={candidatePlaybackUrl(pendingCandidate)!}
          onDone={handleCropDone}
          onCancel={handleCropCancel}
        />
      ) : null}
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sourceLabel: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  sourceName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: FB,
  },
  mediaSection: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#141926',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8A95A3',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    fontFamily: FB,
  },
  input: {
    backgroundColor: '#141926',
    borderWidth: 1,
    borderColor: '#2A3347',
    borderRadius: 10,
    padding: 12,
    minHeight: 84,
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: FB,
    textAlignVertical: 'top',
  },
  charCount: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: '#5B6472',
    marginTop: 4,
    fontFamily: FB,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#1A2130',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  chipActive: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: '#A78BFA',
  },
  chipText: {
    fontSize: 12,
    color: '#B8C0CC',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#A78BFA',
    fontWeight: '600',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#A78BFA',
    paddingVertical: 14,
    borderRadius: 12,
  },
  generateBtnDisabled: {
    opacity: 0.45,
  },
  generateText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FB,
  },
  progressNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    justifyContent: 'center',
  },
  progressNoteText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
  },
  instructionRecap: {
    fontSize: 13,
    color: '#B8C0CC',
    fontStyle: 'italic',
    marginBottom: 12,
    fontFamily: FB,
  },
  candidatesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  candidateCard: {
    backgroundColor: '#141926',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 8,
    overflow: 'hidden',
  },
  candidateVideoWrap: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  candidateLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A78BFA',
    marginBottom: 6,
    fontFamily: FB,
    textAlign: 'center',
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#A78BFA',
    paddingVertical: 10,
    borderRadius: 8,
  },
  selectText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FB,
  },
  tryAgainBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  tryAgainText: {
    fontSize: 13,
    color: '#8A95A3',
    textDecorationLine: 'underline',
    fontFamily: FB,
  },
  creatingBox: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 32,
  },
  creatingStatus: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    fontFamily: FB,
  },
  progressTrack: {
    width: '80%',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2A3347',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#A78BFA',
  },
  errorText: {
    fontSize: 13,
    color: '#E05252',
    marginBottom: 12,
    fontFamily: FB,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#E05252',
    fontFamily: FB,
  },
  disclaimer: {
    fontSize: 12,
    color: '#5B6472',
    textAlign: 'center',
    marginTop: 20,
    fontFamily: FB,
  },
});
