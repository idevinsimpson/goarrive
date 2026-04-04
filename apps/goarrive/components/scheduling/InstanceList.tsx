import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Alert, Linking } from 'react-native';
import { Icon } from '../Icon';
import { BLUE, GREEN, RED, MUTED, FG, FH, FB } from '../../lib/theme';
import { formatTime } from '../../lib/schedulingTypes';
import { type ScheduleState } from '../../hooks/useScheduleState';
import { TIME_OPTIONS } from './constants';

interface Props {
  slot: any;
  state: ScheduleState;
  handleRescheduleInstance: (instanceId: string, newDate: string, newTime: string) => Promise<void>;
  handleSkipInstance: (slotId: string, instanceId: string, reason: string) => Promise<void>;
  handleSaveInstanceNotes: (slotId: string, instanceId: string, notes: string) => Promise<void>;
}

export function InstanceList({ slot, state, handleRescheduleInstance, handleSkipInstance, handleSaveInstanceNotes }: Props) {
  const {
    expandedSlotId, setExpandedSlotId, slotInstances, instanceAttendance,
    rescheduleInstanceId, setRescheduleInstanceId, rescheduleDate, setRescheduleDate,
    rescheduleTime, setRescheduleTime, editingTimeForDay, setEditingTimeForDay,
    skippingInstanceId, setSkippingInstanceId, skipReason, setSkipReason,
    editingNoteId, setEditingNoteId, noteText, setNoteText, instanceNotes,
  } = state;

  return (
    <>
      {/* View Instances toggle */}
      <TouchableOpacity
        style={{ marginTop: 6 }}
        onPress={() => setExpandedSlotId(expandedSlotId === slot.id ? null : slot.id)}
      >
        <Text style={{ fontSize: 11, color: BLUE, fontFamily: FB }}>
          {expandedSlotId === slot.id ? 'Hide Instances' : 'View Instances'}
        </Text>
      </TouchableOpacity>
      {/* Instance list expansion */}
      {expandedSlotId === slot.id && (
        <View style={{ marginTop: 8, paddingLeft: 4 }}>
          {slotInstances.length === 0 ? (
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>No upcoming instances</Text>
          ) : (
            slotInstances.map((inst: any) => {
              const att = instanceAttendance[inst.id];
              const attColor = att?.label === 'Attended' ? GREEN : att?.label === 'Missed' || att?.label === 'No-show' ? RED : MUTED;
              const isRescheduling = rescheduleInstanceId === inst.id;
              return (
              <View key={inst.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: FG, fontFamily: FB }}>
                      {inst.scheduledDate} at {inst.startTime || '—'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontSize: 10, color: inst.status === 'completed' ? GREEN : inst.status === 'missed' ? RED : inst.status === 'skip_requested' ? '#FFC000' : inst.status === 'skipped' ? '#FFC000' : MUTED, fontFamily: FB }}>
                        {inst.status === 'skip_requested' ? 'skip requested' : (inst.status || 'scheduled')}
                      </Text>
                      {att && (
                        <Text style={{ fontSize: 9, color: attColor, fontFamily: FB }}>
                          {att.label}{att.eventCount > 0 ? ` (${att.eventCount} events)` : ''}
                        </Text>
                      )}
                    </View>
                  </View>
                  {inst.status !== 'completed' && inst.status !== 'missed' && (
                    <TouchableOpacity
                      onPress={() => {
                        setRescheduleInstanceId(isRescheduling ? null : inst.id);
                        setRescheduleDate(inst.scheduledDate || '');
                        setRescheduleTime(inst.startTime || '06:00');
                      }}
                    >
                      <Text style={{ fontSize: 10, color: BLUE, fontFamily: FB }}>
                        {isRescheduling ? 'Cancel' : 'Reschedule'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* Reschedule form */}
                {isRescheduling && (
                  <View style={{ marginTop: 6, backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 6, padding: 8 }}>
                    <Text style={{ fontSize: 10, color: MUTED, fontFamily: FH, marginBottom: 4 }}>New Date & Time</Text>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput
                        style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 6, color: FG, fontFamily: FB, fontSize: 11 }}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={MUTED}
                        value={rescheduleDate}
                        onChangeText={setRescheduleDate}
                      />
                      <TouchableOpacity
                        style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 6 }}
                        onPress={() => setEditingTimeForDay(editingTimeForDay === -99 ? null : -99)}
                      >
                        <Text style={{ fontSize: 11, color: FG, fontFamily: FB }}>{formatTime(rescheduleTime)}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ backgroundColor: BLUE + '20', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                        onPress={async () => {
                          if (!rescheduleDate || !rescheduleTime) return;
                          await handleRescheduleInstance(inst.id, rescheduleDate, rescheduleTime);
                          setRescheduleInstanceId(null);
                          Alert.alert('Rescheduled', `Session moved to ${rescheduleDate} at ${formatTime(rescheduleTime)}`);
                        }}
                      >
                        <Text style={{ fontSize: 10, color: BLUE, fontFamily: FH }}>Confirm</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Quick time picker for reschedule */}
                    {editingTimeForDay === -99 && (
                      <ScrollView horizontal style={{ marginTop: 6 }} showsHorizontalScrollIndicator={false}>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {TIME_OPTIONS.filter((_, i) => i % 2 === 0).map(t => (
                            <TouchableOpacity
                              key={t}
                              style={[{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: rescheduleTime === t ? BLUE + '30' : 'rgba(255,255,255,0.06)' }]}
                              onPress={() => { setRescheduleTime(t); setEditingTimeForDay(null); }}
                            >
                              <Text style={{ fontSize: 10, color: rescheduleTime === t ? BLUE : MUTED, fontFamily: FB }}>{formatTime(t)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    )}
                  </View>
                )}
                {/* Skip instance */}
                {inst.status !== 'completed' && inst.status !== 'missed' && inst.status !== 'skipped' && inst.status !== 'skip_requested' && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {skippingInstanceId === inst.id ? (
                      <View style={{ flex: 1, backgroundColor: 'rgba(255,200,0,0.06)', borderRadius: 6, padding: 6 }}>
                        <TextInput
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: 4, color: FG, fontFamily: FB, fontSize: 10, marginBottom: 4 }}
                          placeholder="Reason (e.g., holiday, vacation)"
                          placeholderTextColor={MUTED}
                          value={skipReason}
                          onChangeText={setSkipReason}
                        />
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <TouchableOpacity onPress={() => handleSkipInstance(slot.id, inst.id, skipReason)} style={{ backgroundColor: '#FFC000' + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FH }}>Confirm Skip</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setSkippingInstanceId(null); setSkipReason(''); }}>
                            <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => { setSkippingInstanceId(inst.id); setSkipReason(''); }}>
                        <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FB }}>Skip</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {inst.status === 'skipped' && (inst.skipReason || inst.skipCategory) && (
                  <View style={{ marginTop: 2 }}>
                    <Text style={{ fontSize: 9, color: '#FFC000', fontFamily: FB }}>Skipped{inst.skipCategory ? ` [${inst.skipCategory}]` : ''}{inst.skipReason ? `: ${inst.skipReason}` : ''}</Text>
                    {inst.skipRequestedBy && <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB }}>Requested by member</Text>}
                  </View>
                )}
                {/* Skip request pending — approve/deny buttons */}
                {inst.status === 'skip_requested' && (
                  <SkipRequestBlock slot={slot} inst={inst} />
                )}
                {/* Session notes */}
                <View style={{ marginTop: 4 }}>
                  {editingNoteId === inst.id ? (
                    <View style={{ backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 6, padding: 6 }}>
                      <TextInput
                        style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: 4, color: FG, fontFamily: FB, fontSize: 10, minHeight: 40 }}
                        placeholder="Session notes..."
                        placeholderTextColor={MUTED}
                        value={noteText}
                        onChangeText={setNoteText}
                        multiline
                      />
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => handleSaveInstanceNotes(slot.id, inst.id, noteText)} style={{ backgroundColor: BLUE + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                          <Text style={{ fontSize: 9, color: BLUE, fontFamily: FH }}>Save Note</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setEditingNoteId(null); setNoteText(''); }}>
                          <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {(instanceNotes[inst.id] || inst.notes) ? (
                        <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB, flex: 1 }} numberOfLines={2}>
                          {'\ud83d\udcdd'} {instanceNotes[inst.id] || inst.notes}
                        </Text>
                      ) : null}
                      <TouchableOpacity onPress={() => { setEditingNoteId(inst.id); setNoteText(instanceNotes[inst.id] || inst.notes || ''); }}>
                        <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB }}>{(instanceNotes[inst.id] || inst.notes) ? 'Edit Note' : 'Add Note'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                {/* Zoom recording link */}
                {inst.recordings && inst.recordings.length > 0 && (
                  <View style={{ marginTop: 4, backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 4, padding: 4 }}>
                    <Text style={{ fontSize: 9, color: BLUE, fontFamily: FH, marginBottom: 2 }}>Session Recordings</Text>
                    {inst.recordings.map((rec: any, ri: number) => (
                      <TouchableOpacity
                        key={ri}
                        onPress={() => {
                          const url = rec.playUrl || rec.downloadUrl;
                          if (url) Linking.openURL(url);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}
                      >
                        <Icon name="video" size={10} color={BLUE} />
                        <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }} numberOfLines={1}>
                          {rec.topic || `Recording ${ri + 1}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {inst.zoomRecordingUrl && !inst.recordings?.length && (
                  <ZoomRecordingBlock inst={inst} />
                )}
                {/* Transcription link */}
                {inst.transcriptionUrl && (
                  <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => Linking.openURL(inst.transcriptionUrl)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Icon name="document" size={10} color={BLUE} />
                      <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }}>View Transcript</Text>
                    </TouchableOpacity>
                    {inst.transcriptionStatus && (
                      <Text style={{ fontSize: 8, color: MUTED }}>({inst.transcriptionStatus})</Text>
                    )}
                  </View>
                )}
              </View>
              );
            })
          )}
        </View>
      )}
    </>
  );
}

// ── Inline helper subcomponents (keep adjacent to avoid prop explosion) ──────

function SkipRequestBlock({ slot, inst }: { slot: any; inst: any }) {
  const { httpsCallable } = require('firebase/functions');
  const { functions } = require('../../lib/firebase');
  return (
    <View style={{ marginTop: 4, backgroundColor: 'rgba(255,200,0,0.06)', borderRadius: 6, padding: 6 }}>
      <Text style={{ fontSize: 10, color: '#FFC000', fontFamily: FH, marginBottom: 2 }}>Skip Requested</Text>
      {inst.skipCategory && <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Category: {inst.skipCategory}</Text>}
      {inst.skipReason && <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Reason: {inst.skipReason}</Text>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <TouchableOpacity
          style={{ backgroundColor: GREEN + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}
          onPress={async () => {
            try {
              const fn = httpsCallable(functions, 'updateRecurringSlot');
              await fn({ slotId: slot.id, action: 'approve_skip_request', instanceId: inst.id });
              Alert.alert('Approved', 'Skip request has been approved.');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to approve skip request');
            }
          }}
        >
          <Text style={{ fontSize: 9, color: GREEN, fontFamily: FH }}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ backgroundColor: RED + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 }}
          onPress={async () => {
            try {
              const fn = httpsCallable(functions, 'updateRecurringSlot');
              await fn({ slotId: slot.id, action: 'deny_skip_request', instanceId: inst.id });
              Alert.alert('Denied', 'Skip request has been denied.');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to deny skip request');
            }
          }}
        >
          <Text style={{ fontSize: 9, color: RED, fontFamily: FH }}>Deny</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ZoomRecordingBlock({ inst }: { inst: any }) {
  const { httpsCallable } = require('firebase/functions');
  const { functions } = require('../../lib/firebase');
  return (
    <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <TouchableOpacity
        onPress={() => Linking.openURL(inst.zoomRecordingUrl)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        <Icon name="video" size={10} color={BLUE} />
        <Text style={{ fontSize: 9, color: BLUE, fontFamily: FB, textDecorationLine: 'underline' }}>View Recording</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          try {
            const fn = httpsCallable(functions, 'refreshRecordingUrl');
            const result = await fn({ instanceId: inst.id }) as any;
            if (result.data?.recordingUrl) {
              Linking.openURL(result.data.recordingUrl);
            } else {
              Alert.alert('Info', 'No updated recording URL available.');
            }
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to refresh recording URL');
          }
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
      >
        <Icon name="refresh" size={9} color={MUTED} />
        <Text style={{ fontSize: 8, color: MUTED, fontFamily: FB }}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}
