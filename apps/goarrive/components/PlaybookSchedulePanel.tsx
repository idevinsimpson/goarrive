/**
 * PlaybookSchedulePanel — dead-simple scheduling inside the playbook drill-in.
 *
 * Coach picks day(s), a start time, session kind, and a repeat setting; the
 * bookPlaybookSession Cloud Function does the heavy lifting (transactional
 * member-level overlap guard + per-playbook weekly cap) and reports back
 * per-occurrence results. Shows the playbook TITLE only — never workout
 * names or sequence details.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import {
  DAY_SHORT_LABELS,
  PLAYBOOK_SESSION_KIND_LABELS,
  PlaybookRepeatFrequency,
  PlaybookSessionKind,
} from '../lib/schedulingTypes';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const DURATIONS = [30, 45, 60];
const TIME_PRESETS = ['06:00', '07:00', '09:00', '12:00', '17:00', '18:30'];

interface BookingWindowRow {
  days: number[];
  startTime: string;
  endTime: string;
}

// booking_windows docs written before multi-day support carry dayOfWeek.
function normalizeWindow(w: any): BookingWindowRow {
  return {
    days: Array.isArray(w?.days) ? w.days : (typeof w?.dayOfWeek === 'number' ? [w.dayOfWeek] : []),
    startTime: w?.startTime || '09:00',
    endTime: w?.endTime || '12:00',
  };
}

interface BookResult {
  date: string;
  status: 'booked' | 'conflict' | 'cap_reached';
  reason?: string;
}

interface PlaybookDocLite {
  name?: string;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  memberIds?: string[];
  sessionKind?: PlaybookSessionKind;
  recordingEnabled?: boolean;
  sessionDurationMinutes?: number;
  weeklySessionCap?: number | null;
  timezone?: string;
  scheduleDaysOfWeek?: number[];
  scheduleStartTime?: string;
  repeatFrequency?: PlaybookRepeatFrequency;
  repeatHorizonWeeks?: number;
}

export default function PlaybookSchedulePanel({
  playbookId,
  visible,
  onClose,
}: {
  playbookId: string;
  visible: boolean;
  onClose: () => void;
}) {
  // effectiveUid keeps admin impersonation intact (never user.uid directly)
  const { effectiveUid } = useAuth();
  const [playbook, setPlaybook] = useState<PlaybookDocLite | null>(null);

  const [days, setDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('07:00');
  const [duration, setDuration] = useState(45);
  const [sessionKind, setSessionKind] = useState<PlaybookSessionKind>('coach_review');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [repeatFrequency, setRepeatFrequency] = useState<PlaybookRepeatFrequency>('weekly');
  const [horizonWeeks, setHorizonWeeks] = useState(4);
  const [weeklyCap, setWeeklyCap] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Booking link (Phase 3b): availability windows + public token URL
  const [windows, setWindows] = useState<BookingWindowRow[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Members on this playbook (B.1): coach member list + add/remove
  const [coachMembers, setCoachMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);

  // Live playbook doc — pre-fills the form from previously saved settings.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    const unsub = onSnapshot(
      doc(db, 'playbooks', playbookId),
      (snap) => {
        const data = (snap.data() || {}) as PlaybookDocLite;
        setPlaybook(data);
        if (data.scheduleDaysOfWeek?.length) setDays(data.scheduleDaysOfWeek);
        if (data.scheduleStartTime) setStartTime(data.scheduleStartTime);
        if (data.sessionDurationMinutes) setDuration(data.sessionDurationMinutes);
        if (data.sessionKind) setSessionKind(data.sessionKind);
        if (data.recordingEnabled !== undefined) setRecordingEnabled(data.recordingEnabled !== false);
        if (data.repeatFrequency) setRepeatFrequency(data.repeatFrequency);
        if (data.repeatHorizonWeeks) setHorizonWeeks(data.repeatHorizonWeeks);
        if (data.weeklySessionCap !== undefined) setWeeklyCap(data.weeklySessionCap ?? null);
      },
      (err) => console.error('[PlaybookSchedulePanel] playbook listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  // Prefill saved availability + existing (unrevoked) booking token on open.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    getDoc(doc(db, 'booking_windows', playbookId))
      .then((snap) => {
        const w = snap.data()?.windows;
        if (Array.isArray(w) && w.length) setWindows(w.map(normalizeWindow));
        const locs = snap.data()?.locations;
        if (Array.isArray(locs)) setLocations(locs);
      })
      .catch(() => {});
    getDocs(query(
      collection(db, 'playbook_booking_tokens'),
      where('coachId', '==', effectiveUid),
      where('playbookId', '==', playbookId),
      where('revokedAt', '==', null),
      limit(1),
    ))
      .then((snap) => { if (!snap.empty) setLinkToken(snap.docs[0].id); })
      .catch(() => {});
  }, [visible, playbookId, effectiveUid]);

  // Coach's member list — powers the add-member picker + name lookups.
  useEffect(() => {
    if (!visible || !effectiveUid) return;
    getDocs(query(collection(db, 'members'), where('coachId', '==', effectiveUid)))
      .then((snap) => {
        setCoachMembers(
          snap.docs
            .filter((d) => !d.data().isArchived)
            .map((d) => {
              const x = d.data();
              return { id: d.id, name: x.name || x.displayName || x.email || 'Unnamed' };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((e) => console.error('[PlaybookSchedulePanel] members load error:', e));
  }, [visible, effectiveUid]);

  const playbookMemberIds = useMemo<string[]>(
    () => (playbook?.memberIds?.length
      ? playbook.memberIds
      : (playbook?.assignedMemberId ? [playbook.assignedMemberId] : [])),
    [playbook?.memberIds, playbook?.assignedMemberId],
  );
  const nameOf = useCallback(
    (id: string) => coachMembers.find((m) => m.id === id)?.name
      || (id === playbook?.assignedMemberId ? playbook?.assignedMemberName : null)
      || 'Member',
    [coachMembers, playbook?.assignedMemberId, playbook?.assignedMemberName],
  );

  const writeMembers = useCallback(async (newIds: string[]) => {
    if (memberBusy) return;
    setMemberBusy(true);
    try {
      // assignedMemberId stays in sync for legacy single-member reads
      await updateDoc(doc(db, 'playbooks', playbookId), {
        memberIds: newIds,
        assignedMemberId: newIds[0] || null,
        assignedMemberName: newIds[0] ? nameOf(newIds[0]) : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[PlaybookSchedulePanel] member update error:', e);
    } finally {
      setMemberBusy(false);
    }
  }, [memberBusy, playbookId, nameOf]);

  const memberName = playbook?.assignedMemberName || null;
  const hasMember = playbookMemberIds.length > 0;
  const timezone = useMemo(
    () => playbook?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [playbook?.timezone],
  );

  const toggleDay = useCallback((d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
    setResults(null);
  }, []);

  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime);
  const canBook = hasMember && days.length > 0 && timeValid && !booking;

  const book = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setError(null);
    setResults(null);
    try {
      const fn = httpsCallable(functions, 'bookPlaybookSession');
      const res = await fn({
        playbookId,
        daysOfWeek: days,
        startTime,
        timezone,
        durationMinutes: duration,
        sessionKind,
        recordingEnabled,
        repeatFrequency,
        repeatHorizonWeeks: horizonWeeks,
        weeklySessionCap: weeklyCap,
      });
      const data = res.data as { results: BookResult[] };
      setResults(data.results || []);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking error:', e);
      setError(e?.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  }, [canBook, playbookId, days, startTime, timezone, duration, sessionKind, recordingEnabled, repeatFrequency, horizonWeeks, weeklyCap]);

  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const windowsValid = windows.length > 0 && windows.every(
    (w) => w.days.length > 0 && timeRe.test(w.startTime) && timeRe.test(w.endTime) && w.startTime < w.endTime,
  );

  const bookingUrl = useMemo(() => {
    if (!linkToken) return null;
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/book/${linkToken}`;
  }, [linkToken]);

  const updateWindow = useCallback((i: number, patch: Partial<BookingWindowRow>) => {
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
    setLinkError(null);
  }, []);

  const createLink = useCallback(async () => {
    if (!windowsValid || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const fn = httpsCallable(functions, 'createPlaybookBookingLink');
      const res = await fn({
        playbookId,
        windows,
        timezone,
        locations: locations.map((l) => l.trim()).filter(Boolean),
      });
      const data = res.data as { token: string };
      setLinkToken(data.token);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking link error:', e);
      setLinkError(e?.message || 'Could not create booking link');
    } finally {
      setLinkBusy(false);
    }
  }, [windowsValid, linkBusy, playbookId, windows, timezone, locations]);

  const openPreview = useCallback(() => {
    if (!linkToken) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(`${bookingUrl}?preview=1`, '_blank');
    } else {
      onClose();
      router.push(`/book/${linkToken}?preview=1`);
    }
  }, [linkToken, bookingUrl, onClose]);

  const copyLink = useCallback(async () => {
    if (!bookingUrl) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(bookingUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [bookingUrl]);

  const bookedCount = results?.filter((r) => r.status === 'booked').length ?? 0;
  const problems = results?.filter((r) => r.status !== 'booked') ?? [];

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>Schedule {playbook?.name || 'Playbook'}</Text>
            {hasMember ? (
              <Text style={s.subtitle}>Sessions for {memberName || 'assigned member'}</Text>
            ) : (
              <Text style={[s.subtitle, { color: '#F5A623' }]}>
                Add a member to this playbook before scheduling.
              </Text>
            )}

            <Text style={s.sectionLabel}>Members</Text>
            {playbookMemberIds.map((id) => (
              <View key={id} style={s.memberRow}>
                <Text style={s.memberRowName} numberOfLines={1}>{nameOf(id)}</Text>
                <Pressable
                  style={s.windowRemove}
                  disabled={memberBusy}
                  onPress={() => writeMembers(playbookMemberIds.filter((x) => x !== id))}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {playbookMemberIds.length === 0 && (
              <Text style={s.hint}>No members on this playbook yet.</Text>
            )}
            <Pressable style={s.addWindowBtn} onPress={() => setMemberPickerOpen((v) => !v)}>
              <Text style={s.addWindowText}>{memberPickerOpen ? 'Close member list' : '+ Add member'}</Text>
            </Pressable>
            {memberPickerOpen && (
              <View style={s.memberPicker}>
                {coachMembers.filter((m) => !playbookMemberIds.includes(m.id)).length === 0 && (
                  <Text style={s.hint}>All your members are already on this playbook.</Text>
                )}
                {coachMembers
                  .filter((m) => !playbookMemberIds.includes(m.id))
                  .map((m) => (
                    <Pressable
                      key={m.id}
                      style={s.memberPickRow}
                      disabled={memberBusy}
                      onPress={() => { writeMembers([...playbookMemberIds, m.id]); setMemberPickerOpen(false); }}
                    >
                      <Text style={s.memberPickName} numberOfLines={1}>{m.name}</Text>
                      <Text style={s.memberPickAdd}>Add</Text>
                    </Pressable>
                  ))}
              </View>
            )}

            <Text style={s.sectionLabel}>Days</Text>
            <View style={s.chipRow}>
              {DAY_SHORT_LABELS.map((label, i) => (
                <Pressable
                  key={label}
                  style={[s.dayChip, days.includes(i) && s.dayChipActive]}
                  onPress={() => toggleDay(i)}
                >
                  <Text style={[s.dayChipText, days.includes(i) && s.dayChipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.sectionLabel}>Start Time</Text>
            <View style={s.chipRow}>
              {TIME_PRESETS.map((t) => (
                <Pressable
                  key={t}
                  style={[s.chip, startTime === t && s.chipActive]}
                  onPress={() => { setStartTime(t); setResults(null); }}
                >
                  <Text style={[s.chipText, startTime === t && s.chipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[s.input, !timeValid && { borderColor: '#E5484D', borderWidth: 1 }]}
              value={startTime}
              onChangeText={(v) => { setStartTime(v); setResults(null); }}
              placeholder="HH:mm"
              placeholderTextColor="#4A5568"
              autoCapitalize="none"
            />
            <Text style={s.hint}>Member timezone: {timezone}</Text>

            <Text style={s.sectionLabel}>Duration</Text>
            <View style={s.chipRow}>
              {DURATIONS.map((d) => (
                <Pressable
                  key={d}
                  style={[s.chip, duration === d && s.chipActive]}
                  onPress={() => setDuration(d)}
                >
                  <Text style={[s.chipText, duration === d && s.chipTextActive]}>{d} min</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.sectionLabel}>Session Kind</Text>
            <View style={s.chipRow}>
              {(Object.keys(PLAYBOOK_SESSION_KIND_LABELS) as PlaybookSessionKind[]).map((k) => (
                <Pressable
                  key={k}
                  style={[s.chip, sessionKind === k && s.chipActive]}
                  onPress={() => setSessionKind(k)}
                >
                  <Text style={[s.chipText, sessionKind === k && s.chipTextActive]}>
                    {PLAYBOOK_SESSION_KIND_LABELS[k]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.hint}>
              {sessionKind === 'coach_guided'
                ? 'Runs live in your own Zoom room.'
                : 'Member trains in a hosted room; you review afterward.'}
            </Text>

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Record sessions</Text>
              <Switch
                value={recordingEnabled}
                onValueChange={setRecordingEnabled}
                trackColor={{ false: '#4A5568', true: '#A78BFA' }}
                thumbColor="#F0F4F8"
              />
            </View>

            <Text style={s.sectionLabel}>Repeat</Text>
            <View style={s.chipRow}>
              {([['weekly', 'Weekly'], ['every_2_weeks', 'Every 2 Weeks'], ['none', 'One Time']] as const).map(([v, label]) => (
                <Pressable
                  key={v}
                  style={[s.chip, repeatFrequency === v && s.chipActive]}
                  onPress={() => setRepeatFrequency(v)}
                >
                  <Text style={[s.chipText, repeatFrequency === v && s.chipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {repeatFrequency !== 'none' && (
              <View style={s.stepperRow}>
                <Text style={s.switchLabel}>Book ahead</Text>
                <View style={s.stepper}>
                  <Pressable style={s.stepBtn} onPress={() => setHorizonWeeks((w) => Math.max(2, w - 1))}>
                    <Text style={s.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={s.stepValue}>{horizonWeeks} wks</Text>
                  <Pressable style={s.stepBtn} onPress={() => setHorizonWeeks((w) => Math.min(8, w + 1))}>
                    <Text style={s.stepBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={s.stepperRow}>
              <Text style={s.switchLabel}>Weekly session cap</Text>
              <View style={s.stepper}>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => setWeeklyCap((c) => (c === null || c <= 1 ? null : c - 1))}
                >
                  <Text style={s.stepBtnText}>−</Text>
                </Pressable>
                <Text style={s.stepValue}>{weeklyCap === null ? 'Off' : weeklyCap}</Text>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => setWeeklyCap((c) => Math.min(7, (c ?? 0) + 1))}
                >
                  <Text style={s.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <Text style={s.sectionLabel}>Booking Link</Text>
            <Text style={s.hint}>
              Let the member pick their own times from your availability. The public page shows the
              playbook title only — never workout details.
            </Text>
            {windows.map((w, i) => (
              <View key={i} style={s.windowRow}>
                <View style={s.windowDays}>
                  {DAY_SHORT_LABELS.map((label, d) => (
                    <Pressable
                      key={label}
                      style={[s.miniDayChip, w.days.includes(d) && s.dayChipActive]}
                      onPress={() => updateWindow(i, {
                        days: w.days.includes(d)
                          ? w.days.filter((x) => x !== d)
                          : [...w.days, d].sort((a, b) => a - b),
                      })}
                    >
                      <Text style={[s.miniDayChipText, w.days.includes(d) && s.dayChipTextActive]}>
                        {label[0]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[s.timeInput, !timeRe.test(w.startTime) && s.inputBad]}
                  value={w.startTime}
                  onChangeText={(v) => updateWindow(i, { startTime: v })}
                  placeholder="09:00"
                  placeholderTextColor="#4A5568"
                  autoCapitalize="none"
                />
                <Text style={s.windowDash}>–</Text>
                <TextInput
                  style={[s.timeInput, !timeRe.test(w.endTime) && s.inputBad]}
                  value={w.endTime}
                  onChangeText={(v) => updateWindow(i, { endTime: v })}
                  placeholder="12:00"
                  placeholderTextColor="#4A5568"
                  autoCapitalize="none"
                />
                <Pressable
                  style={s.windowRemove}
                  onPress={() => setWindows((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              style={s.addWindowBtn}
              onPress={() => setWindows((prev) => [...prev, { days: [1], startTime: '09:00', endTime: '12:00' }])}
            >
              <Text style={s.addWindowText}>+ Add availability window</Text>
            </Pressable>

            <Text style={s.sectionLabel}>Locations</Text>
            <Text style={s.hint}>
              Optional — where sessions can happen (e.g. Condo gym, Hotel). The member picks one when booking.
            </Text>
            {locations.map((loc, i) => (
              <View key={i} style={s.windowRow}>
                <TextInput
                  style={[s.timeInput, { flex: 1, width: undefined, textAlign: 'left' }]}
                  value={loc}
                  onChangeText={(v) => { setLocations((prev) => prev.map((x, idx) => (idx === i ? v : x))); setLinkError(null); }}
                  placeholder="Condo gym"
                  placeholderTextColor="#4A5568"
                  maxLength={80}
                />
                <Pressable
                  style={s.windowRemove}
                  onPress={() => setLocations((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {locations.length < 10 && (
              <Pressable style={s.addWindowBtn} onPress={() => setLocations((prev) => [...prev, ''])}>
                <Text style={s.addWindowText}>+ Add location option</Text>
              </Pressable>
            )}
            {windows.length > 0 && (
              <Pressable
                style={[s.btn, { backgroundColor: windowsValid && !linkBusy ? '#1E2A3A' : '#161D29', borderWidth: 1, borderColor: '#A78BFA', marginTop: 10 }]}
                onPress={createLink}
                disabled={!windowsValid || linkBusy}
              >
                <Text style={{ color: '#A78BFA', fontWeight: '700', fontFamily: FH }}>
                  {linkBusy ? 'Saving…' : linkToken ? 'Update Availability' : 'Create Booking Link'}
                </Text>
              </Pressable>
            )}
            {linkError && <Text style={s.error}>{linkError}</Text>}
            {bookingUrl && (
              <View style={s.linkBox}>
                <Text style={s.linkUrl} numberOfLines={1}>{bookingUrl}</Text>
                <Pressable style={s.copyBtn} onPress={copyLink}>
                  <Text style={s.copyBtnText}>{linkCopied ? 'Copied' : 'Copy'}</Text>
                </Pressable>
                <Pressable style={s.previewBtn} onPress={openPreview}>
                  <Text style={s.previewBtnText}>Preview</Text>
                </Pressable>
              </View>
            )}

            {error && <Text style={s.error}>{error}</Text>}
            {results && (
              <View style={s.resultBox}>
                <Text style={s.resultTitle}>
                  {bookedCount} session{bookedCount === 1 ? '' : 's'} booked
                </Text>
                {problems.map((p) => (
                  <Text key={p.date} style={s.resultProblem}>
                    {p.date}: {p.status === 'cap_reached' ? 'weekly cap reached' : `conflict — ${p.reason || 'time taken'}`}
                  </Text>
                ))}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable style={[s.btn, { backgroundColor: '#0E1117' }]} onPress={onClose}>
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Close</Text>
              </Pressable>
              <Pressable
                style={[s.btn, { backgroundColor: canBook ? '#A78BFA' : '#4A5568', flex: 1 }]}
                onPress={book}
                disabled={!canBook}
              >
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>
                  {booking ? 'Booking…' : 'Book Sessions'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '88%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  subtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4A5568',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    width: 42,
    paddingVertical: 8,
    backgroundColor: '#0E1117',
    borderRadius: 20,
    alignItems: 'center',
  },
  dayChipActive: {
    backgroundColor: '#A78BFA',
  },
  dayChipText: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  dayChipTextActive: {
    color: '#0E1117',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#0E1117',
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: '#A78BFA',
  },
  chipText: {
    color: '#8A95A3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#0E1117',
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    color: '#F0F4F8',
    fontSize: 15,
    fontFamily: FB,
    marginTop: 8,
    width: 120,
  },
  hint: {
    color: '#4A5568',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  switchLabel: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: '#A78BFA',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  stepValue: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    minWidth: 48,
    textAlign: 'center',
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#E5484D',
    fontSize: 13,
    fontFamily: FB,
    marginTop: 14,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  windowDays: {
    flexDirection: 'row',
    gap: 4,
  },
  miniDayChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniDayChipText: {
    color: '#8A95A3',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
  },
  timeInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
    width: 62,
    textAlign: 'center',
  },
  inputBad: {
    borderColor: '#E5484D',
    borderWidth: 1,
  },
  windowDash: {
    color: '#4A5568',
    fontSize: 14,
    fontFamily: FB,
  },
  windowRemove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowRemoveText: {
    color: '#E5484D',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FB,
  },
  addWindowBtn: {
    marginTop: 10,
  },
  addWindowText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  linkUrl: {
    flex: 1,
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  copyBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  copyBtnText: {
    color: '#0E1117',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  previewBtn: {
    borderColor: '#A78BFA',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  previewBtnText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 6,
    gap: 8,
  },
  memberRowName: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    flex: 1,
  },
  memberPicker: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    maxHeight: 220,
  },
  memberPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 8,
  },
  memberPickName: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    flex: 1,
  },
  memberPickAdd: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  resultBox: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  resultTitle: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  resultProblem: {
    color: '#F5A623',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 4,
  },
});
