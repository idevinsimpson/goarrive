/**
 * Public Calendly-style booking page — /book/{token} (Phase 3b).
 *
 * Resolves an unguessable booking token through
 * resolvePlaybookBookingToken (Admin SDK, title-only projection — never
 * workout names). Signed-in members on the playbook book as themselves;
 * anyone else books as a guest by email, then gets a nudge to create an
 * account so the coach knows it's really the member.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { BG, CARD, BORDER, FG, MUTED, GREEN, RED, FH, FB } from '../../lib/theme';

const RESOLVE_URL = 'https://us-central1-goarrive.cloudfunctions.net/resolvePlaybookBookingToken';

interface Slot {
  date: string;
  startTime: string;
  startUtcMillis: number;
  capReached: boolean;
}

interface BookingInfo {
  playbookTitle: string;
  coachName: string | null;
  memberName: string | null;
  guestMode: boolean;
  sessionKind: 'coach_guided' | 'coach_review';
  durationMinutes: number;
  timezone: string;
  weeklySessionCap: number | null;
  capState: { booked: number; cap: number } | null;
  slots: Slot[];
}

const ACCENT = '#A78BFA';

function friendlyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function BookingPage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();

  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');
  const [booked, setBooked] = useState<{ date: string; startTime: string; guest: boolean } | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guestEmail.trim());

  const load = useCallback(async (withGuestEmail?: string) => {
    setLoading(true);
    setError('');
    try {
      const qs = withGuestEmail ? `&guestEmail=${encodeURIComponent(withGuestEmail)}` : '';
      const resp = await fetch(`${RESOLVE_URL}?token=${encodeURIComponent(token!)}${qs}`);
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.error || 'This booking link is not available.');
        return;
      }
      setInfo(json);
    } catch (err) {
      console.error('[BookingPage] resolve error:', err);
      setError('Something went wrong loading this booking page.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || authLoading) return;
    load();
  }, [token, authLoading, load]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of info?.slots || []) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return [...map.entries()];
  }, [info?.slots]);

  const needsEmail = !!info?.guestMode || !user;
  const canBook = !!selected && !selected.capReached && !booking && (!needsEmail || emailValid);

  const book = useCallback(async () => {
    if (!selected || !canBook) return;
    setBooking(true);
    setBookError('');
    try {
      const fn = httpsCallable(functions, 'bookViaBookingToken');
      const res = await fn({
        token,
        date: selected.date,
        startTime: selected.startTime,
        ...(needsEmail ? { guestEmail: guestEmail.trim() } : {}),
      });
      const data = res.data as { guest: boolean };
      setBooked({ date: selected.date, startTime: selected.startTime, guest: data.guest });
    } catch (e: any) {
      console.error('[BookingPage] booking error:', e);
      setBookError(e?.message || 'Booking failed — that time may have just been taken.');
      load(needsEmail && emailValid ? guestEmail.trim() : undefined);
    } finally {
      setBooking(false);
    }
  }, [selected, canBook, token, needsEmail, guestEmail, load]);

  if (loading || authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.errorTitle}>Booking unavailable</Text>
        <Text style={s.errorBody}>{error}</Text>
      </View>
    );
  }

  if (!info) return null;

  if (booked) {
    return (
      <View style={s.center}>
        <View style={s.card}>
          <Text style={s.bigCheck}>✓</Text>
          <Text style={s.doneTitle}>You're booked</Text>
          <Text style={s.doneBody}>
            {info.playbookTitle} — {friendlyDate(booked.date)} at {friendlyTime(booked.startTime)} ({info.timezone})
          </Text>
          {booked.guest ? (
            <>
              <Text style={s.nudge}>
                Create a free GoArrive account with this same email so your coach knows it's you —
                you'll see your sessions, get reminders, and check in with one tap.
              </Text>
              <Pressable style={s.primaryBtn} onPress={() => router.push('/(auth)/login')}>
                <Text style={s.primaryBtnText}>Create My Account</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={s.primaryBtn} onPress={() => router.push('/(member)/my-sessions')}>
              <Text style={s.primaryBtnText}>View My Sessions</Text>
            </Pressable>
          )}
          <Pressable
            style={s.ghostBtn}
            onPress={() => { setBooked(null); setSelected(null); load(booked.guest ? guestEmail.trim() : undefined); }}
          >
            <Text style={s.ghostBtnText}>Book another time</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={s.page}>
      <View style={s.card}>
        <Text style={s.brand}>G➲A</Text>
        <Text style={s.title}>{info.playbookTitle}</Text>
        <Text style={s.subtitle}>
          {info.coachName ? `with Coach ${info.coachName} · ` : ''}
          {info.durationMinutes} min · {info.sessionKind === 'coach_guided' ? 'live with your coach' : 'coach reviews after'}
        </Text>
        {info.memberName && <Text style={s.memberLine}>Booking for {info.memberName}</Text>}
        <Text style={s.tzLine}>Times shown in {info.timezone}</Text>

        {info.capState && (
          <View style={s.capBanner}>
            <Text style={s.capText}>
              {info.capState.booked} of {info.capState.cap} session{info.capState.cap === 1 ? '' : 's'} booked this week
            </Text>
          </View>
        )}

        {needsEmail && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.sectionLabel}>Your Email</Text>
            <TextInput
              style={s.emailInput}
              value={guestEmail}
              onChangeText={setGuestEmail}
              onBlur={() => { if (emailValid) load(guestEmail.trim()); }}
              placeholder="you@example.com"
              placeholderTextColor="#4A5568"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <Text style={s.hint}>
              Book with just your email — no account needed. You can create one after.
            </Text>
          </View>
        )}

        <Text style={s.sectionLabel}>Pick a Time</Text>
        {slotsByDate.length === 0 && (
          <Text style={s.hint}>No open times in the next few weeks. Check back soon.</Text>
        )}
        {slotsByDate.map(([date, slots]) => (
          <View key={date} style={{ marginTop: 12 }}>
            <Text style={s.dateLabel}>{friendlyDate(date)}</Text>
            <View style={s.slotRow}>
              {slots.map((slot) => {
                const isSel = selected?.startUtcMillis === slot.startUtcMillis;
                return (
                  <Pressable
                    key={slot.startUtcMillis}
                    style={[s.slotChip, isSel && s.slotChipSel, slot.capReached && s.slotChipCapped]}
                    disabled={slot.capReached}
                    onPress={() => { setSelected(slot); setBookError(''); }}
                  >
                    <Text style={[s.slotText, isSel && s.slotTextSel, slot.capReached && s.slotTextCapped]}>
                      {friendlyTime(slot.startTime)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {slots.every((x) => x.capReached) && (
              <Text style={s.cappedNote}>Weekly session limit reached for this week</Text>
            )}
          </View>
        ))}

        {bookError !== '' && <Text style={s.bookError}>{bookError}</Text>}

        <Pressable
          style={[s.primaryBtn, !canBook && s.primaryBtnDisabled]}
          onPress={book}
          disabled={!canBook}
        >
          <Text style={s.primaryBtnText}>
            {booking
              ? 'Booking…'
              : selected
                ? `Book ${friendlyDate(selected.date)} · ${friendlyTime(selected.startTime)}`
                : 'Select a time'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: {
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: BG,
  },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
  },
  brand: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: FH,
    letterSpacing: 2,
  },
  title: {
    color: FG,
    fontSize: 24,
    fontWeight: '800',
    fontFamily: FH,
    marginTop: 8,
  },
  subtitle: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    marginTop: 6,
  },
  memberLine: {
    color: FG,
    fontSize: 13,
    fontFamily: FB,
    marginTop: 8,
  },
  tzLine: {
    color: '#4A5568',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 4,
  },
  capBanner: {
    backgroundColor: BG,
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  capText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4A5568',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 4,
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  emailInput: {
    backgroundColor: BG,
    borderRadius: 10,
    padding: 12,
    color: FG,
    fontSize: 15,
    fontFamily: FB,
    marginTop: 6,
  },
  hint: {
    color: '#4A5568',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
  },
  dateLabel: {
    color: FG,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  slotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  slotChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: BG,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  slotChipSel: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  slotChipCapped: {
    opacity: 0.35,
  },
  slotText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  slotTextSel: {
    color: BG,
  },
  slotTextCapped: {
    color: '#4A5568',
  },
  cappedNote: {
    color: '#F5A623',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
  },
  bookError: {
    color: RED,
    fontSize: 13,
    fontFamily: FB,
    marginTop: 14,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnDisabled: {
    backgroundColor: '#4A5568',
  },
  primaryBtnText: {
    color: BG,
    fontSize: 15,
    fontWeight: '800',
    fontFamily: FH,
  },
  ghostBtn: {
    alignItems: 'center',
    marginTop: 14,
  },
  ghostBtnText: {
    color: MUTED,
    fontSize: 13,
    fontFamily: FB,
  },
  bigCheck: {
    color: GREEN,
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
  },
  doneTitle: {
    color: FG,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: FH,
    textAlign: 'center',
    marginTop: 8,
  },
  doneBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 8,
  },
  nudge: {
    color: FG,
    fontSize: 13,
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 19,
  },
  errorTitle: {
    color: FG,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: FH,
  },
  errorBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    marginTop: 8,
    textAlign: 'center',
  },
});
