import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { BLUE, GOLD, RED, MUTED, FG, FH, FB } from '../../lib/theme';
import { type ScheduleState } from '../../hooks/useScheduleState';

interface Props {
  state: ScheduleState;
  coachId: string;
  handleLoadTemplate: (template: any) => void;
  handleBatchCreate: () => void;
}

export function BatchCreator({ state, coachId, handleLoadTemplate, handleBatchCreate }: Props) {
  const {
    editingSlotId, showBatchPicker, setShowBatchPicker,
    slotTemplates, sharedTemplates,
    batchMembers, selectedBatchMembers, setSelectedBatchMembers,
    batchCreating, batchOverrides, setBatchOverrides,
  } = state;

  return (
    <>
      {/* Batch creation button */}
      {!editingSlotId && (
        <TouchableOpacity
          style={{ marginBottom: 8, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: BLUE + '40', alignItems: 'center' }}
          onPress={() => setShowBatchPicker(true)}
        >
          <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH }}>Apply to Multiple Members</Text>
        </TouchableOpacity>
      )}

      {/* Batch member picker modal */}
      {showBatchPicker && (
        <View style={{ backgroundColor: 'rgba(91,155,213,0.06)', borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: BLUE + '20' }}>
          {/* Batch template picker */}
          {(slotTemplates.length > 0 || sharedTemplates.length > 0) && (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 11, color: GOLD, fontFamily: FH, marginBottom: 4 }}>Apply Template First</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[...slotTemplates, ...sharedTemplates].map((t: any) => (
                    <TouchableOpacity
                      key={t.id}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: GOLD + '40', backgroundColor: 'rgba(245,166,35,0.08)' }}
                      onPress={() => handleLoadTemplate(t)}
                    >
                      <Text style={{ fontSize: 10, color: GOLD, fontFamily: FB }}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB }}>Tap a template to load its settings, then select members below.</Text>
            </View>
          )}
          <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH, marginBottom: 6 }}>Select Members</Text>
          {batchMembers.length === 0 ? (
            <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB }}>Loading members...</Text>
          ) : (
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
              {batchMembers.map((bm: any) => (
                <TouchableOpacity
                  key={bm.id}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}
                  onPress={() => {
                    setSelectedBatchMembers(prev => {
                      const next = new Set(prev);
                      if (next.has(bm.id)) next.delete(bm.id); else next.add(bm.id);
                      return next;
                    });
                  }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 3, borderWidth: 1, borderColor: selectedBatchMembers.has(bm.id) ? BLUE : MUTED, backgroundColor: selectedBatchMembers.has(bm.id) ? BLUE + '30' : 'transparent', marginRight: 8, alignItems: 'center', justifyContent: 'center' }}>
                    {selectedBatchMembers.has(bm.id) && <Text style={{ fontSize: 10, color: BLUE }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{bm.name || bm.id}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {/* Per-member day/time overrides */}
          {selectedBatchMembers.size > 0 && (
            <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 8 }}>
              <Text style={{ fontSize: 11, color: GOLD, fontFamily: FH, marginBottom: 4 }}>Per-Member Overrides (optional)</Text>
              <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB, marginBottom: 6 }}>Set a different day or time for specific members. Leave blank to use the form defaults.</Text>
              {batchMembers.filter(bm => selectedBatchMembers.has(bm.id)).map((bm: any) => {
                const ov = batchOverrides[bm.id];
                const dayVal = ov?.dayOfWeek ?? '';
                const timeVal = ov?.startTime ?? '';
                const dayInvalid = dayVal !== '' && (!/^[0-6]$/.test(dayVal));
                const timeInvalid = timeVal !== '' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeVal));
                return (
                  <View key={bm.id} style={{ marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 10, color: FG, fontFamily: FB, width: 80 }} numberOfLines={1}>{bm.name || bm.id}</Text>
                      <TextInput
                        style={{ flex: 1, backgroundColor: '#0E1117', borderRadius: 4, borderWidth: 1, borderColor: dayInvalid ? '#FF5722' : MUTED + '30', color: FG, fontSize: 10, fontFamily: FB, paddingHorizontal: 6, paddingVertical: 3 }}
                        placeholder="Day (0=Sun..6=Sat)"
                        placeholderTextColor={MUTED}
                        value={dayVal}
                        onChangeText={(v) => setBatchOverrides(prev => ({ ...prev, [bm.id]: { ...prev[bm.id], dayOfWeek: v || undefined } }))}
                        keyboardType="numeric"
                        maxLength={1}
                      />
                      <TextInput
                        style={{ flex: 1, backgroundColor: '#0E1117', borderRadius: 4, borderWidth: 1, borderColor: timeInvalid ? '#FF5722' : MUTED + '30', color: FG, fontSize: 10, fontFamily: FB, paddingHorizontal: 6, paddingVertical: 3 }}
                        placeholder="Time (HH:MM)"
                        placeholderTextColor={MUTED}
                        value={timeVal}
                        onChangeText={(v) => setBatchOverrides(prev => ({ ...prev, [bm.id]: { ...prev[bm.id], startTime: v || undefined } }))}
                        maxLength={5}
                      />
                    </View>
                    {(dayInvalid || timeInvalid) && (
                      <Text style={{ fontSize: 8, color: '#FF5722', fontFamily: FB, marginLeft: 86, marginTop: 2 }}>
                        {dayInvalid ? 'Day must be 0-6 (0=Sun, 1=Mon, ..., 6=Sat)' : ''}
                        {dayInvalid && timeInvalid ? ' · ' : ''}
                        {timeInvalid ? 'Time must be HH:MM (e.g. 09:00)' : ''}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: BLUE, paddingVertical: 8, borderRadius: 6, alignItems: 'center', opacity: selectedBatchMembers.size === 0 || batchCreating || (() => {
                for (const bmId of Array.from(selectedBatchMembers)) {
                  const ov = batchOverrides[bmId];
                  if (ov?.dayOfWeek && !/^[0-6]$/.test(ov.dayOfWeek)) return true;
                  if (ov?.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ov.startTime)) return true;
                }
                return false;
              })() ? 0.5 : 1 }}
              onPress={handleBatchCreate}
              disabled={selectedBatchMembers.size === 0 || batchCreating || (() => {
                for (const bmId of Array.from(selectedBatchMembers)) {
                  const ov = batchOverrides[bmId];
                  if (ov?.dayOfWeek && !/^[0-6]$/.test(ov.dayOfWeek)) return true;
                  if (ov?.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ov.startTime)) return true;
                }
                return false;
              })()}
            >
              <Text style={{ fontSize: 12, color: '#fff', fontFamily: FH }}>
                {batchCreating ? 'Creating...' : `Create for ${selectedBatchMembers.size} Members`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 }}
              onPress={() => { setShowBatchPicker(false); setSelectedBatchMembers(new Set()); }}
            >
              <Text style={{ fontSize: 12, color: MUTED, fontFamily: FB }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );
}
