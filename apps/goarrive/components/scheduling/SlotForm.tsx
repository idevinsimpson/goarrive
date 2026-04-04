import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Icon } from '../Icon';
import { DAY_LABELS, DAY_SHORT_LABELS, formatTime, addMinutesToTime, type GuidancePhase, type SchedulingSessionType } from '../../lib/schedulingTypes';
import { BG, BLUE, GREEN, RED, MUTED, GOLD, FG, FH, FB } from '../../lib/theme';
import { STEP, DURATION_OPTIONS, type ScheduleState, type DayTimeEntry } from '../../hooks/useScheduleState';
import { TIME_OPTIONS, TIMEZONE_OPTIONS, SCHED_PHASE_LABELS } from './constants';
import { s } from './styles';
import { BatchCreator } from './BatchCreator';

// Forward-declare DualHandleSlider type — imported by parent and passed as prop
type DualHandleSliderComponent = React.ComponentType<{
  totalMinutes: number;
  liveStart: number;
  liveEnd: number;
  onChangeStart: (v: number) => void;
  onChangeEnd: (v: number) => void;
}>;

interface Props {
  state: ScheduleState;
  coachId: string;
  activeSlots: any[];
  // Computed values from ScheduleModal
  usedSessionTypes: Set<string>;
  sessionTypeWarning: string | null;
  autoPhaseForSessionType: GuidancePhase | null;
  phaseWeekMap: Record<GuidancePhase, number>;
  planPhases: any[] | null;
  resolvedRoomSource: string;
  // Handlers
  resetForm: () => void;
  handleLoadTemplate: (template: any) => void;
  handleDeleteTemplate: (templateId: string) => void;
  handleSaveTemplate: () => void;
  handleCreateOrUpdate: () => void;
  handleBatchCreate: () => void;
  toggleDay: (dayIdx: number) => void;
  updateDayTime: (dayIdx: number, time: string) => void;
  // Components
  DualHandleSlider: DualHandleSliderComponent;
}

export function SlotForm({
  state, coachId, activeSlots,
  usedSessionTypes, sessionTypeWarning, autoPhaseForSessionType, phaseWeekMap, planPhases, resolvedRoomSource,
  resetForm, handleLoadTemplate, handleDeleteTemplate, handleSaveTemplate, handleCreateOrUpdate, handleBatchCreate,
  toggleDay, updateDayTime,
  DualHandleSlider,
}: Props) {
  const {
    selectedDays, editingTimeForDay, selectedDuration, selectedTimezone,
    selectedPattern, selectedWeekOfMonth, selectedSessionType, selectedPhase,
    creating, editingSlotId, liveStart, liveEnd, planPhaseOverride,
    templateName, showSaveTemplate, showTemplateMenu,
    setSelectedDays, setEditingTimeForDay, setSelectedDuration, setSelectedTimezone,
    setSelectedPattern, setSelectedWeekOfMonth, setSelectedSessionType, setSelectedPhase,
    setPlanPhaseOverride, setTemplateName, setShowSaveTemplate, setShowTemplateMenu, setLiveStart, setLiveEnd,
    slotTemplates, sharedTemplates, templateUpdateAvailable,
    conflictWarning, conflictSuggestions,
  } = state;

  return (
    <View style={s.schedSection}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.schedSectionTitle}>
          {editingSlotId ? 'Edit Slot' : (activeSlots.length > 0 ? 'Add More Slots' : 'Create Recurring Slots')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {editingSlotId && (
            <TouchableOpacity onPress={resetForm}>
              <Text style={[s.overrideLink, { color: MUTED }]}>Cancel Edit</Text>
            </TouchableOpacity>
          )}
          {slotTemplates.length > 0 && (
            <TouchableOpacity onPress={() => setShowTemplateMenu(!showTemplateMenu)}>
              <Text style={{ fontSize: 11, color: BLUE, fontFamily: FB }}>Templates</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setShowSaveTemplate(!showSaveTemplate)}>
            <Text style={{ fontSize: 11, color: GREEN, fontFamily: FB }}>Save as Template</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Template menu dropdown */}
      {showTemplateMenu && (slotTemplates.length > 0 || sharedTemplates.length > 0) && (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
          {slotTemplates.length > 0 && (
            <>
              <Text style={{ fontSize: 11, color: MUTED, fontFamily: FH, marginBottom: 4 }}>My Templates</Text>
              {slotTemplates.map((t: any) => (
                <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => handleLoadTemplate(t)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{t.name}</Text>
                      {templateUpdateAvailable[t.id] && (
                        <View style={{ backgroundColor: '#FFC000' + '20', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 }}>
                          <Text style={{ fontSize: 8, color: '#FFC000', fontFamily: FH }}>Update Available</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB }}>
                      {t.sessionType} · {t.guidancePhase} · {t.durationMinutes}min · {t.recurrencePattern}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={async () => {
                      try {
                        const { addDoc, collection, doc, updateDoc } = require('firebase/firestore');
                        const { db } = require('../../lib/firebase');
                        const version = (t.version || 0) + 1;
                        await addDoc(collection(db, 'shared_templates'), { ...t, sharedBy: coachId, sharedAt: new Date(), version });
                        const tRef = doc(db, 'coaches', coachId, 'slot_templates', t.id);
                        await updateDoc(tRef, { version });
                        const { Alert } = require('react-native');
                        Alert.alert('Shared', 'Template shared with all coaches');
                      } catch (err) { console.error('Share failed:', err); }
                    }}>
                      <Text style={{ fontSize: 10, color: BLUE, fontFamily: FB }}>Share</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteTemplate(t.id)}>
                      <Text style={{ fontSize: 10, color: RED, fontFamily: FB }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}
          {sharedTemplates.length > 0 && (
            <>
              <Text style={{ fontSize: 11, color: BLUE, fontFamily: FH, marginTop: slotTemplates.length > 0 ? 8 : 0, marginBottom: 4 }}>Shared Templates</Text>
              {sharedTemplates.map((t: any) => (
                <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => handleLoadTemplate(t)}>
                    <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{t.name}</Text>
                    <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB }}>
                      {t.sessionType} · {t.guidancePhase} · {t.durationMinutes}min · {t.recurrencePattern}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </View>
      )}

      {/* Save template input */}
      {showSaveTemplate && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <TextInput
            style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 8, color: FG, fontFamily: FB, fontSize: 12 }}
            placeholder="Template name..."
            placeholderTextColor={MUTED}
            value={templateName}
            onChangeText={setTemplateName}
          />
          <TouchableOpacity
            style={{ backgroundColor: GREEN + '20', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 }}
            onPress={handleSaveTemplate}
          >
            <Text style={{ fontSize: 11, color: GREEN, fontFamily: FH }}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowSaveTemplate(false); setTemplateName(''); }}>
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Session Type */}
      <Text style={s.fieldLabel}>Session Type</Text>
      <View style={s.dayRow}>
        {(['strength', 'cardio', 'flexibility', 'hiit', 'recovery', 'check_in'] as SchedulingSessionType[]).map(st => {
          const isUsed = usedSessionTypes.has(st) && !editingSlotId;
          return (
            <TouchableOpacity
              key={st}
              style={[s.dayBtn, selectedSessionType === st && s.dayBtnActive, isUsed && { opacity: 0.4 }, { minWidth: 70 }]}
              onPress={() => setSelectedSessionType(st)}
            >
              <Text style={[s.dayBtnText, selectedSessionType === st && s.dayBtnTextActive, { fontSize: 12 }]}>
                {st === 'check_in' ? 'Check-in' : st.charAt(0).toUpperCase() + st.slice(1)}
              </Text>
              {isUsed && <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB, marginTop: 1 }}>Active</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
      {sessionTypeWarning && (
        <View style={{ backgroundColor: 'rgba(245,166,35,0.1)', padding: 8, borderRadius: 6, marginTop: 6 }}>
          <Text style={{ fontSize: 11, color: GOLD, fontFamily: FB }}>
            {'\u26a0'} {sessionTypeWarning}
          </Text>
        </View>
      )}

      {/* Guidance Phase */}
      {selectedSessionType !== 'check_in' && (<>
      <View style={s.phaseHeaderRow}>
        <Text style={s.fieldLabel}>Guidance Phase</Text>
        {planPhases && !planPhaseOverride && (
          <TouchableOpacity onPress={() => setPlanPhaseOverride(true)}>
            <Text style={s.overrideLink}>Override</Text>
          </TouchableOpacity>
        )}
        {planPhaseOverride && (
          <TouchableOpacity onPress={() => setPlanPhaseOverride(false)}>
            <Text style={[s.overrideLink, { color: GREEN }]}>Sync to plan</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={s.dayRow}>
        {([
          { key: 'coach_guided' as GuidancePhase, label: 'Coach Guided', color: GREEN },
          { key: 'shared_guidance' as GuidancePhase, label: 'Shared Guidance', color: '#5B9BD5' },
          { key: 'self_guided' as GuidancePhase, label: 'Self Guided', color: '#FFC000' },
        ] as const).map(phase => {
          const weekCount = phaseWeekMap[phase.key];
          const isDisabled = !planPhaseOverride && autoPhaseForSessionType !== null;
          return (
            <TouchableOpacity
              key={phase.key}
              style={[
                s.phaseBtn,
                selectedPhase === phase.key && { backgroundColor: phase.color + '18', borderColor: phase.color + '60' },
                isDisabled && selectedPhase !== phase.key && { opacity: 0.35 },
              ]}
              onPress={() => {
                if (!isDisabled) setSelectedPhase(phase.key);
              }}
              disabled={isDisabled}
            >
              <Text style={[s.phaseBtnLabel, selectedPhase === phase.key && { color: phase.color }]}>
                {phase.label}
              </Text>
              {weekCount > 0 && (
                <Text style={[s.phaseBtnWeeks, selectedPhase === phase.key && { color: phase.color }]}>
                  {weekCount} weeks
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      {!planPhaseOverride && autoPhaseForSessionType !== null && (
        <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB, marginTop: 4, fontStyle: 'italic' }}>
          Auto-set from plan. Tap "Override" to change.
        </Text>
      )}
      </>)}
      {selectedSessionType === 'check_in' && (
        <View style={s.roomSourceRow}>
          <Icon name="info" size={14} color={GREEN} />
          <Text style={[s.roomSourceText, { color: GREEN }]}>Check-in — always coach-guided, monthly</Text>
        </View>
      )}

      {/* Hosting Mode Indicator */}
      {selectedSessionType !== 'check_in' && (
        <View style={s.roomSourceRow}>
          <Icon name="info" size={14} color={MUTED} />
          <Text style={s.roomSourceText}>
            {selectedPhase === 'coach_guided'
              ? 'Coach-led \u2014 sessions use your personal Zoom'
              : 'Hosted \u2014 sessions use shared infrastructure'}
          </Text>
        </View>
      )}

      {/* Shared Guidance Window */}
      {selectedPhase === 'shared_guidance' && selectedSessionType !== 'check_in' && (
        <View style={s.sliderSection}>
          <Text style={s.fieldLabel}>Shared Guidance Window</Text>
          <Text style={s.fieldHint}>Drag the handles to set when you'll be guiding your member</Text>
          <DualHandleSlider
            totalMinutes={selectedDuration}
            liveStart={liveStart}
            liveEnd={liveEnd}
            onChangeStart={setLiveStart}
            onChangeEnd={setLiveEnd}
          />
        </View>
      )}

      {/* Multi-Day Selector */}
      <Text style={s.fieldLabel}>Days & Times</Text>
      <Text style={s.fieldHint}>Tap days to select. Each day gets its own start time.</Text>
      <View style={s.dayRow}>
        {DAY_SHORT_LABELS.map((label, idx) => {
          const isSelected = selectedDays.some(d => d.dayOfWeek === idx);
          return (
            <TouchableOpacity
              key={idx}
              style={[s.dayBtn, isSelected && s.dayBtnActive]}
              onPress={() => toggleDay(idx)}
            >
              <Text style={[s.dayBtnText, isSelected && s.dayBtnTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Per-day time pickers */}
      {selectedDays.map(entry => (
        <View key={entry.dayOfWeek} style={s.dayTimeRow}>
          <View style={s.dayTimeLabel}>
            <Text style={s.dayTimeDayText}>{DAY_LABELS[entry.dayOfWeek]}</Text>
          </View>
          <TouchableOpacity
            style={s.dayTimeBtn}
            onPress={() => setEditingTimeForDay(editingTimeForDay === entry.dayOfWeek ? null : entry.dayOfWeek)}
          >
            <Text style={s.dayTimeBtnText}>{formatTime(entry.startTime)}</Text>
            <Icon name="chevron-down" size={14} color={MUTED} />
          </TouchableOpacity>
          <Text style={s.dayTimeEnd}>— {formatTime(addMinutesToTime(entry.startTime, selectedDuration))}</Text>
        </View>
      ))}

      {/* Time picker dropdown */}
      {editingTimeForDay !== null && (
        <View style={s.timePickerWrap}>
          <Text style={s.timePickerTitle}>Set time for {DAY_LABELS[editingTimeForDay]}</Text>
          <ScrollView style={s.timeList} nestedScrollEnabled>
            {TIME_OPTIONS.map(t => {
              const isActive = selectedDays.find(d => d.dayOfWeek === editingTimeForDay)?.startTime === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[s.timeOption, isActive && s.timeOptionActive]}
                  onPress={() => updateDayTime(editingTimeForDay, t)}
                >
                  <Text style={[s.timeOptionText, isActive && { color: GOLD }]}>{formatTime(t)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Duration */}
      <Text style={s.fieldLabel}>Duration — {selectedDuration} min</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
        <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
          {DURATION_OPTIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.dayBtn, selectedDuration === d && s.dayBtnActive, { minWidth: 48, paddingHorizontal: 8 }]}
              onPress={() => setSelectedDuration(d)}
            >
              <Text style={[s.dayBtnText, selectedDuration === d && s.dayBtnTextActive, { fontSize: 12 }]}>{d}m</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Pattern */}
      <Text style={s.fieldLabel}>Recurrence</Text>
      <View style={s.dayRow}>
        {(['weekly', 'biweekly', 'monthly'] as const).map(p => (
          <TouchableOpacity
            key={p}
            style={[s.dayBtn, selectedPattern === p && s.dayBtnActive, { minWidth: 80 }]}
            onPress={() => setSelectedPattern(p)}
          >
            <Text style={[s.dayBtnText, selectedPattern === p && s.dayBtnTextActive]}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Week of Month */}
      {selectedPattern === 'monthly' && (
        <>
          <Text style={s.fieldLabel}>Which week?</Text>
          <View style={s.dayRow}>
            {([1, 2, 3, 4] as const).map(w => {
              const labels = ['1st', '2nd', '3rd', '4th'];
              return (
                <TouchableOpacity
                  key={w}
                  style={[s.dayBtn, selectedWeekOfMonth === w && s.dayBtnActive, { minWidth: 60 }]}
                  onPress={() => setSelectedWeekOfMonth(w)}
                >
                  <Text style={[s.dayBtnText, selectedWeekOfMonth === w && s.dayBtnTextActive]}>{labels[w - 1]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* Timezone */}
      <Text style={s.fieldLabel}>Timezone</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={[s.dayRow, { flexWrap: 'nowrap' }]}>
          {TIMEZONE_OPTIONS.map(tz => {
            const short = tz.split('/')[1]?.replace(/_/g, ' ') || tz;
            return (
              <TouchableOpacity
                key={tz}
                style={[s.dayBtn, selectedTimezone === tz && s.dayBtnActive, { minWidth: 70 }]}
                onPress={() => setSelectedTimezone(tz)}
              >
                <Text style={[s.dayBtnText, selectedTimezone === tz && s.dayBtnTextActive, { fontSize: 11 }]}>{short}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Summary */}
      <View style={s.summaryCard}>
        <Text style={s.summaryText}>
          {selectedDays.length === 1
            ? `${DAY_LABELS[selectedDays[0].dayOfWeek]}s at ${formatTime(selectedDays[0].startTime)} for ${selectedDuration} min`
            : `${selectedDays.length} days/week for ${selectedDuration} min each`}
          {selectedPattern === 'monthly'
            ? `, ${['1st', '2nd', '3rd', '4th'][selectedWeekOfMonth - 1]} week monthly`
            : `, ${selectedPattern}`}
        </Text>
        {selectedDays.length > 1 && (
          <Text style={s.summaryDays}>
            {selectedDays.map(d => `${DAY_SHORT_LABELS[d.dayOfWeek]} ${formatTime(d.startTime)}`).join(' · ')}
          </Text>
        )}
        <Text style={s.summaryMeta}>
          {selectedSessionType === 'check_in' ? 'Check-in' : selectedSessionType.charAt(0).toUpperCase() + selectedSessionType.slice(1)}
          {' · '}{SCHED_PHASE_LABELS[selectedPhase]}
          {selectedPhase === 'shared_guidance' && ` (${liveEnd - liveStart}min live)`}
        </Text>
        <Text style={s.summaryMeta}>
          {resolvedRoomSource === 'coach_personal' ? 'Coach-led (Your Zoom)' : 'Hosted'}
          {' \u00b7 '}{selectedTimezone.split('/')[1]?.replace(/_/g, ' ')} time
        </Text>
        {selectedPhase === 'shared_guidance' && (
          <Text style={[s.summaryMeta, { color: GOLD }]}>
            Calendar block: {liveEnd - liveStart} min (join at {liveStart}min, leave at {liveEnd}min)
          </Text>
        )}
      </View>

      {/* Conflict Warning */}
      {conflictWarning && (
        <View style={{ backgroundColor: 'rgba(224,82,82,0.1)', padding: 10, borderRadius: 6, marginBottom: 8, borderWidth: 1, borderColor: RED + '40' }}>
          <Text style={{ fontSize: 12, color: RED, fontFamily: FH, marginBottom: 4 }}>{'\u26a0'} Schedule Conflict</Text>
          <Text style={{ fontSize: 11, color: RED, fontFamily: FB }}>{conflictWarning}</Text>
          <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB, marginTop: 4, fontStyle: 'italic' }}>You can still create this slot, but you'll need to be in two places at once.</Text>
          {conflictSuggestions.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 10, color: GREEN, fontFamily: FH, marginBottom: 4 }}>Available times:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {conflictSuggestions.map((sg, i) => (
                  <TouchableOpacity
                    key={i}
                    style={{ backgroundColor: GREEN + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: GREEN + '30' }}
                    onPress={() => {
                      const [hStr, rest] = sg.time.split(':');
                      const mStr = rest.slice(0, 2);
                      const ampm = rest.slice(3);
                      let h = parseInt(hStr);
                      if (ampm === 'PM' && h !== 12) h += 12;
                      if (ampm === 'AM' && h === 12) h = 0;
                      const newTime = `${h.toString().padStart(2, '0')}:${mStr}`;
                      setSelectedDays(prev => prev.map(d => d.dayOfWeek === sg.dayIdx ? { ...d, startTime: newTime } : d));
                    }}
                  >
                    <Text style={{ fontSize: 10, color: GREEN, fontFamily: FB }}>{sg.day} {sg.time}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      <BatchCreator
        state={state}
        coachId={coachId}
        handleLoadTemplate={handleLoadTemplate}
        handleBatchCreate={handleBatchCreate}
      />

      {/* Create Button */}
      <TouchableOpacity
        style={s.createBtn}
        onPress={handleCreateOrUpdate}
        disabled={creating}
      >
        {creating ? (
          <ActivityIndicator size="small" color={BG} />
        ) : (
          <Text style={s.createBtnText}>
            {editingSlotId
              ? 'Update Slot'
              : selectedDays.length > 1
                ? `Create ${selectedDays.length} Recurring Slots`
                : 'Create Recurring Slot'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
