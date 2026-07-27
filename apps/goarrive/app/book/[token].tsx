/**
 * Public Calendly-style booking page — /book/{token} (Phase 3b, reworked B.1).
 *
 * Resolves an unguessable booking token through
 * resolvePlaybookBookingToken (Admin SDK, title-only projection — never
 * workout names). Month-view calendar → pick a day → pick a time →
 * (optional) pick a location → confirm. Signed-in members on the playbook
 * book as themselves; anyone else books as a guest by email.
 *
 * ?preview=1 renders the exact member view for the coach with booking
 * disabled.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { BG, CARD, BORDER, FG, MUTED, GOLD, GREEN, RED, FH, FB } from '../../lib/theme';

const RESOLVE_URL = 'https://us-central1-goarrive.cloudfunctions.net/resolvePlaybookBookingToken';

// Brand tokens from .claude/design-system.md — "GO" sage / "ARRIVE" steel blue
const GO = '#7BA05B';
const ARRIVE = '#7BA7D4';
const DIM = '#4A5568';

interface Slot {
  date: string;
  startTime: string;
  startUtcMillis: number;
  capReached: boolean;
}

interface BookingInfo {
  playbookTitle: string;
  playbookDescription?: string | null;
  coachId?: string | null;
  coachName: string | null;
  memberName: string | null;
  guestMode: boolean;
  sessionKind: 'coach_guided' | 'coach_review';
  durationMinutes: number;
  timezone: string;
  weeklySessionCap: number | null;
  capState: { booked: number; cap: number } | null;
  locations: string[];
  slots: Slot[];
}

interface BookedResult {
  date: string;
  startTime: string;
  guest: boolean;
  location: string | null;
  icsUrl: string | null;
  googleCalUrl: string | null;
  instanceId: string | null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

function ymKey(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// Hard client deadline on the booking callable — a request that dies without
// settling must never leave the button stuck on "Booking…".
const BOOKING_TIMEOUT_MS = 45000;
const BOOKING_TIMEOUT_SENTINEL = 'booking-client-timeout';

// Crypto-random idempotency key for the booking call.
function makeRequestId(): string {
  const bytes = new Uint8Array(16);
  const c = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A bad timezone from the server would make every Intl call downstream
// throw — fall back to the device timezone.
function safeTimezone(tz: unknown): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof tz !== 'string' || !tz) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
  else Linking.openURL(url).catch(() => {});
}

export default function BookingPage() {
  const { token, preview } = useLocalSearchParams<{ token: string; preview?: string }>();
  const previewMode = preview === '1' || preview === 'true';
  const { user, claims, effectiveUid, loading: authLoading } = useAuth();

  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [monthIdx, setMonthIdx] = useState(0);
  const [booking, setBooking] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [bookError, setBookError] = useState('');
  // Kept across attempts on purpose: an unresolved (timed-out) booking must
  // keep its idempotency key so any retry can't double-book.
  const pendingRequestIdRef = useRef<string | null>(null);
  const [booked, setBooked] = useState<BookedResult | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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
      setInfo({
        ...json,
        timezone: safeTimezone(json.timezone),
        locations: Array.isArray(json.locations) ? json.locations : [],
      });
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
    return map;
  }, [info?.slots]);

  // Months spanned by the booking horizon (from today through the last slot).
  const months = useMemo(() => {
    const now = new Date();
    const first = { y: now.getFullYear(), m: now.getMonth() };
    const dates = [...slotsByDate.keys()].sort();
    const lastDate = dates[dates.length - 1];
    const out = [first];
    if (lastDate) {
      const [ly, lm] = lastDate.split('-').map(Number);
      let y = first.y;
      let m = first.m;
      while (y < ly || (y === ly && m < lm - 1)) {
        m += 1;
        if (m > 11) { m = 0; y += 1; }
        out.push({ y, m });
      }
    }
    return out;
  }, [slotsByDate]);

  useEffect(() => { if (monthIdx >= months.length) setMonthIdx(0); }, [months, monthIdx]);

  const daySlots = selectedDate ? (slotsByDate.get(selectedDate) || []) : [];
  // A signed-in coach on their own playbook can book on behalf of the member,
  // including from preview mode (testing-phase behavior). Server enforces too.
  const isCoach = !!info?.coachId && (
    user?.uid === info.coachId || effectiveUid === info.coachId || claims?.coachId === info.coachId
  );
  const needsEmail = (!!info?.guestMode || !user) && !isCoach;
  const needsLocation = (info?.locations.length || 0) > 0;
  const canBook = !!selected && !selected.capReached && !booking
    && (!needsEmail || emailValid) && (!needsLocation || !!location)
    && (!previewMode || isCoach);

  const pageUrl = useMemo(() => {
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/book/${token}`;
  }, [token]);

  const copyPageLink = useCallback(async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(pageUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [pageUrl]);

  const goBackToApp = useCallback(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      router.replace('/(app)/build' as any);
    }
  }, []);

  const book = useCallback(async () => {
    if (!selected || !canBook) return;
    setBooking(true);
    setBookError('');
    setCheckingStatus(false);
    // Reuse the request ID from a timed-out attempt: the server dedupes on
    // clientRequestId, so the retry either returns the stored result (the
    // first attempt actually landed) or books fresh — never double-books.
    const clientRequestId = pendingRequestIdRef.current || makeRequestId();
    pendingRequestIdRef.current = clientRequestId;
    try {
      const fn = httpsCallable(functions, 'bookViaBookingToken');
      const payload = {
        token,
        date: selected.date,
        startTime: selected.startTime,
        ...(needsEmail ? { guestEmail: guestEmail.trim() } : {}),
        ...(location ? { location } : {}),
        clientRequestId,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await Promise.race([
            fn(payload),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(BOOKING_TIMEOUT_SENTINEL)), BOOKING_TIMEOUT_MS);
            }),
          ]);
          const data = res.data as {
            guest: boolean; icsUrl?: string; googleCalUrl?: string; location?: string | null;
            date?: string; startTime?: string; instanceId?: string;
          };
          pendingRequestIdRef.current = null;
          setBooked({
            // Prefer the server's stored occurrence — an idempotent replay
            // returns the originally booked slot.
            date: data.date || selected.date,
            startTime: data.startTime || selected.startTime,
            guest: data.guest,
            location: data.location || null,
            icsUrl: data.icsUrl || null,
            googleCalUrl: data.googleCalUrl || null,
            instanceId: data.instanceId || null,
          });
          return;
        } catch (e: any) {
          const timedOut = e?.message === BOOKING_TIMEOUT_SENTINEL;
          if (timedOut && attempt === 0) {
            // May have landed server-side — retry with the SAME
            // clientRequestId to fetch the stored result instead of rebooking.
            setCheckingStatus(true);
            continue;
          }
          if (!timedOut) pendingRequestIdRef.current = null;
          throw timedOut
            ? new Error('Booking timed out — tap Book again to check status (it will not double-book)')
            : e;
        }
      }
    } catch (e: any) {
      console.error('[BookingPage] booking error:', e);
      setBookError(e?.message || 'Booking failed — that time may have just been taken.');
      load(needsEmail && emailValid ? guestEmail.trim() : undefined);
    } finally {
      setBooking(false);
      setCheckingStatus(false);
    }
  }, [selected, canBook, token, needsEmail, guestEmail, emailValid, location, load]);

  if (loading || authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={GO} size="large" />
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
          <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" accessibilityLabel="GoArrive" />
          <Text style={s.bigCheck}>✓</Text>
          <Text style={s.doneTitle}>You're booked</Text>
          <Text style={s.doneBody}>
            {info.playbookTitle} — {friendlyDate(booked.date)} at {friendlyTime(booked.startTime)} ({info.timezone})
          </Text>
          {booked.location && <Text style={s.doneLocation}>Location: {booked.location}</Text>}
          <Text style={s.doneHint}>A confirmation email with calendar invite is on its way.</Text>

          <View style={s.calRow}>
            {booked.googleCalUrl && (
              <Pressable style={s.calBtn} onPress={() => openUrl(booked.googleCalUrl!)}>
                <Text style={s.calBtnText}>Google Calendar</Text>
              </Pressable>
            )}
            {booked.icsUrl && (
              <Pressable style={s.calBtn} onPress={() => openUrl(booked.icsUrl!)}>
                <Text style={s.calBtnText}>Download .ics</Text>
              </Pressable>
            )}
          </View>

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
            <>
              {booked.instanceId && (
                <Pressable style={s.primaryBtn} onPress={() => router.push(`/live-session/${booked.instanceId}` as any)}>
                  <Text style={s.primaryBtnText}>Go to Session Page</Text>
                </Pressable>
              )}
              <Pressable style={booked.instanceId ? s.ghostBtn : s.primaryBtn} onPress={() => router.push('/(member)/my-sessions')}>
                <Text style={booked.instanceId ? s.ghostBtnText : s.primaryBtnText}>View My Sessions</Text>
              </Pressable>
            </>
          )}
          <Pressable
            style={s.ghostBtn}
            onPress={() => {
              setBooked(null); setSelected(null); setSelectedDate(null); setLocation(null);
              load(booked.guest ? guestEmail.trim() : undefined);
            }}
          >
            <Text style={s.ghostBtnText}>Book another time</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // C11: day tap takes over the full screen — back arrow, weekday heading,
  // timezone row, time slots. Booking controls live here too.
  if (selectedDate) {
    const [sy, sm, sd] = selectedDate.split('-').map(Number);
    const selDate = new Date(Date.UTC(sy, sm - 1, sd, 12));
    const weekdayName = selDate.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
    const longDate = selDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return (
      <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={s.page}>
        <View style={s.card}>
          <View style={s.headerRow}>
            <Pressable
              style={s.headerBtn}
              onPress={() => { setSelectedDate(null); setSelected(null); setBookError(''); }}
              accessibilityLabel="Back to calendar"
            >
              <Text style={s.headerBtnText}>‹</Text>
            </Pressable>
            {previewMode && (
              <View style={s.previewPill}><Text style={s.previewPillText}>Preview</Text></View>
            )}
            <View style={s.headerBtnGhost} />
          </View>
          <Text style={s.dayHeading}>{weekdayName}</Text>
          <Text style={s.daySubheading}>{longDate}</Text>
          <View style={s.tzRow}>
            <Text style={s.tzRowLabel}>Time zone</Text>
            <Text style={s.tzRowValue}>{info.timezone}</Text>
          </View>
          <Text style={s.sectionLabel}>Select a Time</Text>
          <Text style={s.hint}>Duration: {info.durationMinutes} min</Text>
          <View style={s.slotCol}>
            {daySlots.map((slot) => {
              const isSel = selected?.startUtcMillis === slot.startUtcMillis;
              return (
                <Pressable
                  key={slot.startUtcMillis}
                  style={[s.slotBtn, isSel && s.slotBtnSel, slot.capReached && s.slotChipCapped]}
                  disabled={slot.capReached}
                  onPress={() => { setSelected(slot); setBookError(''); }}
                >
                  <Text style={[s.slotBtnText, isSel && s.slotBtnTextSel, slot.capReached && s.slotTextCapped]}>
                    {friendlyTime(slot.startTime)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {daySlots.length > 0 && daySlots.every((x) => x.capReached) && (
            <Text style={s.cappedNote}>Weekly session limit reached for this week</Text>
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
                placeholderTextColor={DIM}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <Text style={s.hint}>
                Book with just your email — no account needed. You can create one after.
              </Text>
            </View>
          )}

          {needsLocation && selected && (
            <>
              <Text style={s.sectionLabel}>Where will you train?</Text>
              <View style={s.slotRow}>
                {info.locations.map((loc) => {
                  const isSel = location === loc;
                  return (
                    <Pressable
                      key={loc}
                      style={[s.slotChip, isSel && s.slotChipSel]}
                      onPress={() => { setLocation(loc); setBookError(''); }}
                    >
                      <Text style={[s.slotText, isSel && s.slotTextSel]}>{loc}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {bookError !== '' && <Text style={s.bookError}>{bookError}</Text>}

          <Pressable
            style={[s.primaryBtn, !canBook && s.primaryBtnDisabled]}
            onPress={book}
            disabled={!canBook}
          >
            <Text style={s.primaryBtnText}>
              {previewMode && !isCoach
                ? 'Preview — booking disabled'
                : booking
                  ? (checkingStatus ? 'Checking status…' : 'Booking…')
                  : selected
                    ? needsLocation && !location
                      ? 'Pick a location'
                      : `Book ${friendlyDate(selected.date)} · ${friendlyTime(selected.startTime)}`
                    : 'Select a time'}
            </Text>
          </Pressable>
          {previewMode && isCoach && selected && (
            <Text style={s.hint}>Preview booking runs a real booking on behalf of your member.</Text>
          )}
        </View>
      </ScrollView>
    );
  }

  const { y, m } = months[Math.min(monthIdx, months.length - 1)];
  const firstDow = new Date(Date.UTC(y, m, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  const cells: Array<{ day: number; dateStr: string; available: boolean } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const daySlotList = slotsByDate.get(dateStr) || [];
    cells.push({ day: d, dateStr, available: daySlotList.some((x) => !x.capReached) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={s.page}>
      <View style={s.card}>
        <View style={s.headerRow}>
          <Pressable style={s.headerBtn} onPress={() => setMenuOpen(true)} accessibilityLabel="Menu">
            <Text style={s.headerBtnText}>☰</Text>
          </Pressable>
          {previewMode && (
            <View style={s.previewPill}><Text style={s.previewPillText}>Preview</Text></View>
          )}
          <Pressable
            style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.55, transform: [{ scale: 0.96 }] }]}
            onPress={copyPageLink}
            accessibilityLabel="Copy link"
          >
            <Text style={s.copyBtnText}>{linkCopied ? 'Copied!' : 'Copy link'}</Text>
          </Pressable>
        </View>
        <Image source={require('../../assets/logo.png')} style={s.logo} resizeMode="contain" accessibilityLabel="GoArrive" />
        <Text style={s.title}>{info.playbookTitle}</Text>
        <Text style={s.subtitle}>
          {info.coachName ? `with Coach ${info.coachName} · ` : ''}
          {info.durationMinutes} min{info.sessionKind === 'coach_guided' ? ' · live with your coach' : ''}
        </Text>
        {!!info.playbookDescription && (
          <Text style={s.description}>{info.playbookDescription}</Text>
        )}
        {previewMode && isCoach && (
          <Pressable style={s.backToAppBtn} onPress={goBackToApp}>
            <Text style={s.backToAppText}>‹ Back to Playbook</Text>
          </Pressable>
        )}
        {info.memberName && <Text style={s.memberLine}>Booking for {info.memberName}</Text>}
        <Text style={s.tzLine}>Times shown in {info.timezone}</Text>

        {info.capState && (
          <View style={s.capBanner}>
            <Text style={s.capText}>
              {info.capState.booked} of {info.capState.cap} session{info.capState.cap === 1 ? '' : 's'} booked this week
            </Text>
          </View>
        )}

        <Text style={s.sectionLabel}>Select a Day</Text>
        {slotsByDate.size === 0 && (
          <Text style={s.hint}>No open times in the next few weeks. Check back soon.</Text>
        )}
        {slotsByDate.size > 0 && (
          <View style={s.calendar}>
            <View style={s.monthHeader}>
              <Pressable
                style={[s.monthNavBtn, monthIdx === 0 && s.monthNavBtnOff]}
                disabled={monthIdx === 0}
                onPress={() => setMonthIdx((i) => Math.max(0, i - 1))}
              >
                <Text style={[s.monthNavText, monthIdx === 0 && s.monthNavTextOff]}>‹</Text>
              </Pressable>
              <Text style={s.monthTitle}>{MONTH_NAMES[m]} {y}</Text>
              <Pressable
                style={[s.monthNavBtn, monthIdx >= months.length - 1 && s.monthNavBtnOff]}
                disabled={monthIdx >= months.length - 1}
                onPress={() => setMonthIdx((i) => Math.min(months.length - 1, i + 1))}
              >
                <Text style={[s.monthNavText, monthIdx >= months.length - 1 && s.monthNavTextOff]}>›</Text>
              </Pressable>
            </View>
            <View style={s.dowRow}>
              {DOW_LABELS.map((d, i) => (
                <Text key={`${d}${i}`} style={s.dowLabel}>{d}</Text>
              ))}
            </View>
            {weeks.map((week, wi) => (
              <View key={`${ymKey(y, m)}-${wi}`} style={s.weekRow}>
                {week.map((cell, ci) => {
                  if (!cell) return <View key={ci} style={s.dayCell} />;
                  const isSel = selectedDate === cell.dateStr;
                  return (
                    <Pressable
                      key={ci}
                      style={[s.dayCell, cell.available && s.dayCellAvail, isSel && s.dayCellSel]}
                      disabled={!cell.available}
                      onPress={() => {
                        setSelectedDate(cell.dateStr);
                        setSelected(null);
                        setBookError('');
                      }}
                    >
                      <Text style={[s.dayText, !cell.available && s.dayTextOff, cell.available && s.dayTextAvail, isSel && s.dayTextSel]}>
                        {cell.day}
                      </Text>
                      {cell.available && !isSel && <View style={s.dayDot} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        )}

      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={s.menuSheet} onPress={() => {}}>
            <Pressable
              style={s.menuItem}
              onPress={() => { setMenuOpen(false); router.push('/' as any); }}
            >
              <Text style={s.menuItemText}>Home</Text>
            </Pressable>
            {isCoach && (
              <Pressable
                style={s.menuItem}
                onPress={() => { setMenuOpen(false); goBackToApp(); }}
              >
                <Text style={s.menuItemText}>Back to Playbook</Text>
              </Pressable>
            )}
            <Pressable style={s.menuClose} onPress={() => setMenuOpen(false)}>
              <Text style={s.menuCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerBtn: {
    minWidth: 36,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnGhost: {
    minWidth: 36,
    height: 32,
  },
  headerBtnText: {
    color: FG,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
    lineHeight: 20,
  },
  copyBtnText: {
    color: ARRIVE,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  previewPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderColor: GOLD,
    borderWidth: 1,
    backgroundColor: BG,
  },
  previewPillText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
    letterSpacing: 0.5,
  },
  logo: {
    width: 132,
    height: 36,
    alignSelf: 'center',
    marginBottom: 4,
  },
  title: {
    color: FG,
    fontSize: 24,
    fontWeight: '800',
    fontFamily: FH,
    marginTop: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    marginTop: 6,
    textAlign: 'center',
  },
  description: {
    color: MUTED,
    fontSize: 13,
    fontFamily: FB,
    marginTop: 10,
    lineHeight: 19,
    textAlign: 'center',
  },
  backToAppBtn: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderColor: BORDER,
    borderWidth: 1,
    backgroundColor: BG,
  },
  backToAppText: {
    color: FG,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  memberLine: {
    color: FG,
    fontSize: 13,
    fontFamily: FB,
    marginTop: 8,
    textAlign: 'center',
  },
  tzLine: {
    color: DIM,
    fontSize: 12,
    fontFamily: FB,
    marginTop: 4,
    textAlign: 'center',
  },
  dayHeading: {
    color: FG,
    fontSize: 24,
    fontWeight: '800',
    fontFamily: FH,
    marginTop: 6,
  },
  daySubheading: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    marginTop: 4,
  },
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BG,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  tzRowLabel: {
    color: DIM,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  tzRowValue: {
    color: FG,
    fontSize: 13,
    fontFamily: FB,
  },
  slotCol: {
    marginTop: 8,
    gap: 8,
  },
  slotBtn: {
    paddingVertical: 12,
    backgroundColor: BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  slotBtnSel: {
    backgroundColor: GO,
    borderColor: GO,
  },
  slotBtnText: {
    color: FG,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FB,
  },
  slotBtnTextSel: {
    color: BG,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: BORDER,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 32,
  },
  menuItem: {
    paddingVertical: 14,
    borderBottomColor: BORDER,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemText: {
    color: FG,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FH,
  },
  menuClose: {
    alignSelf: 'center',
    marginTop: 18,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
  },
  menuCloseText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FB,
  },
  capBanner: {
    backgroundColor: BG,
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  capText: {
    color: ARRIVE,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: DIM,
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
    color: DIM,
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
  },
  calendar: {
    backgroundColor: BG,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavBtnOff: {
    opacity: 0.3,
  },
  monthNavText: {
    color: GO,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  monthNavTextOff: {
    color: DIM,
  },
  monthTitle: {
    color: FG,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FH,
  },
  dowRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dowLabel: {
    flex: 1,
    textAlign: 'center',
    color: DIM,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    margin: 1,
  },
  dayCellAvail: {
    backgroundColor: CARD,
  },
  dayCellSel: {
    backgroundColor: GO,
  },
  dayText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  dayTextOff: {
    color: '#2A3444',
  },
  dayTextAvail: {
    color: FG,
  },
  dayTextSel: {
    color: BG,
    fontWeight: '800',
  },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: GO,
    marginTop: 2,
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
    backgroundColor: GO,
    borderColor: GO,
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
    color: DIM,
  },
  cappedNote: {
    color: GOLD,
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
    backgroundColor: GO,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnDisabled: {
    backgroundColor: DIM,
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
  doneLocation: {
    color: ARRIVE,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 6,
  },
  doneHint: {
    color: DIM,
    fontSize: 12,
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 8,
  },
  calRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 14,
    flexWrap: 'wrap',
  },
  calBtn: {
    borderColor: ARRIVE,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  calBtnText: {
    color: ARRIVE,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
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
