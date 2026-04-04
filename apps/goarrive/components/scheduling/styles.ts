/**
 * Scheduling styles — shared stylesheet for ScheduleModal and its subcomponents.
 */
import { StyleSheet, Platform, Dimensions } from 'react-native';
import { BG, CARD, BORDER, MUTED, GOLD, GREEN, FG, FH, FB } from '../../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Slider constants ────────────────────────────────────────────────────────
const SLIDER_TRACK_WIDTH = Math.min(SCREEN_W - 80, 340);
const HANDLE_SIZE = 28;

export { SCREEN_W, SLIDER_TRACK_WIDTH, HANDLE_SIZE };

// ── Dual-Handle Slider Styles ───────────────────────────────────────────────
export const sl = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  labelsRow: {
    flexDirection: 'row',
    width: SLIDER_TRACK_WIDTH,
    marginBottom: 6,
    alignItems: 'center',
  },
  zoneLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  zoneLabelLive: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
  },
  track: {
    height: 24,
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'visible',
    position: 'relative',
    ...(Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none' } as any : {}),
  },
  zoneSelf: {
    height: 24,
    backgroundColor: 'rgba(138,149,163,0.2)',
  },
  zoneLive: {
    height: 24,
    backgroundColor: 'rgba(245,166,35,0.35)',
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: GOLD,
    ...(Platform.OS === 'web' ? { touchAction: 'none', cursor: 'grab' } as any : {}),
  },
  handle: {
    position: 'absolute',
    top: -2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#F0F4F8',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web'
      ? { cursor: 'grab', boxShadow: '0 2px 6px rgba(0,0,0,0.4)', touchAction: 'none', userSelect: 'none' } as any
      : { elevation: 4 }
    ),
    zIndex: 10,
  },
  handleInner: {
    flexDirection: 'row',
    gap: 2,
  },
  handleGrip: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: MUTED,
  },
  markersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  marker: {
    fontSize: 9,
    color: MUTED,
    fontFamily: FB,
  },
  summaryRow: {
    alignItems: 'center',
    marginTop: 10,
    gap: 2,
  },
  summaryHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
  },
});

export const s = StyleSheet.create({
  // ── Schedule Modal Styles ──────────────────────────────────────────────
  schedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  schedSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: BORDER,
    borderBottomWidth: 0,
  },
  schedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  schedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  schedSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  schedSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 14,
  },
  fieldHint: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginBottom: 8,
    marginTop: -4,
  },
  dayRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  dayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: '#A78BFA',
  },
  dayBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  dayBtnTextActive: {
    color: '#A78BFA',
  },

  // ── Phase buttons (taller, with week count) ───────────────────────────
  phaseBtn: {
    flex: 1,
    minWidth: 90,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    gap: 2,
  },
  phaseBtnLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  phaseBtnWeeks: {
    fontSize: 10,
    fontWeight: '500',
    color: MUTED,
    fontFamily: FB,
  },
  phaseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  overrideLink: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },

  // ── Room source indicator ──────────────────────────────────���──────────
  roomSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  roomSourceText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    flex: 1,
  },

  // ── Slider section ────────────────────────────────────────────────────
  sliderSection: {
    marginTop: 4,
    paddingTop: 4,
    paddingBottom: 4,
  },

  // ── Multi-day time rows ────────────────────────────────────────────���──
  dayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  dayTimeLabel: {
    width: 80,
  },
  dayTimeDayText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  dayTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dayTimeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
    fontFamily: FB,
  },
  dayTimeEnd: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  timePickerWrap: {
    marginTop: 8,
    backgroundColor: BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  timePickerTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  selectBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  timeList: {
    maxHeight: 180,
    backgroundColor: BG,
  },
  timeOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timeOptionActive: {
    backgroundColor: 'rgba(167,139,250,0.1)',
  },
  timeOptionText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,42,58,0.3)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  slotDay: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  slotMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 2,
  },
  slotActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  slotActionText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  summaryCard: {
    backgroundColor: 'rgba(167,139,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    borderRadius: 10,
    padding: 14,
    marginTop: 16,
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
    textAlign: 'center',
  },
  summaryDays: {
    fontSize: 12,
    fontWeight: '500',
    color: '#A78BFA',
    fontFamily: FB,
    marginTop: 4,
    textAlign: 'center',
  },
  summaryMeta: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
    marginTop: 4,
  },
  createBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  createBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: BG,
    fontFamily: FH,
  },

  // ── Phase Timeline ────────────────────────────────────────────────────
  timelineWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  timelineTitleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  editPlanBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  timelineBar: {
    flexDirection: 'row',
    height: 28,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  timelineSegment: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 28,
  },
  timelineSegText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FB,
  },
  timelineLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: MUTED,
    fontFamily: FB,
  },
  currentPhaseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: CARD + '80',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  currentPhaseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  currentPhaseText: {
    fontSize: 12,
    color: MUTED,
    fontFamily: FB,
  },
  phaseTransitionBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  phaseTransitionTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseTransitionTriggerText: {
    fontSize: 12,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FB,
  },
  phaseTransitionPicker: {
    gap: 8,
  },
  phaseTransitionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  phaseTransitionOptions: {
    flexDirection: 'row',
    gap: 6,
  },
  phaseTransitionChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(30,42,58,0.5)',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  phaseTransitionChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  phaseTransitionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  phaseTransitionCancel: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  phaseTransitionCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    fontFamily: FB,
  },
  phaseTransitionConfirm: {
    flex: 2,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: GOLD,
    alignItems: 'center',
  },
  phaseTransitionConfirmText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B1120',
    fontFamily: FB,
  },
  ctsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  ctsText: {
    fontSize: 12,
    color: GOLD,
    fontFamily: FB,
  },
});
