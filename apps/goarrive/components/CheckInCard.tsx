/**
 * CheckInCard — Check-in card for the Dashboard.
 *
 * Two modes:
 *  - No props: member's own daily check-in (reads/writes check_ins collection).
 *  - checkin prop: historical record display (member name, time, status).
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Icon } from './Icon';
import {
  collection,
  getDocs,
  addDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { FB, FH } from '../lib/theme';

export interface CheckInRecord {
  id: string;
  memberName?: string;
  memberId?: string;
  timestamp?: { toDate?: () => Date };
  status?: string;
  completed?: boolean;
  [key: string]: any;
}

interface Props {
  checkin?: CheckInRecord;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CheckInCard({ checkin }: Props) {
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(!checkin);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (checkin || !user) return;
    loadToday();
  }, [user, checkin]);

  async function loadToday() {
    if (!user) return;
    setLoading(true);
    try {
      const today = todayStr();
      const q = query(
        collection(db, 'check_ins'),
        where('uid', '==', user.uid),
        where('date', '==', today),
      );
      const snap = await getDocs(q);
      setChecked(!snap.empty);
    } catch (err) {
      console.error('[CheckInCard] load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckIn() {
    if (!user || checked || saving) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'check_ins'), {
        uid: user.uid,
        date: todayStr(),
        completed: true,
        createdAt: serverTimestamp(),
      });
      setChecked(true);
    } catch (err) {
      console.error('[CheckInCard] save error:', err);
    } finally {
      setSaving(false);
    }
  }

  // Historical record mode
  if (checkin) {
    const name = checkin.memberName || checkin.memberId || 'Member';
    const ts = checkin.timestamp?.toDate?.();
    const timeStr = ts
      ? ts.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Unknown time';
    const isCompleted = checkin.completed || checkin.status === 'completed';
    return (
      <View style={s.card}>
        <View style={s.row}>
          <Icon
            name="check-circle"
            size={22}
            color={isCompleted ? '#F5A623' : '#4B5563'}
          />
          <View style={[s.textCol, { marginLeft: 12 }]}>
            <Text style={s.title}>{name}</Text>
            <Text style={s.subtitle}>{timeStr}</Text>
          </View>
          {checkin.status ? (
            <Text style={[s.statusBadge, isCompleted && s.statusBadgeDone]}>
              {isCompleted ? 'Done' : checkin.status}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  // Self check-in mode
  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator color="#F5A623" size="small" />
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={s.textCol}>
          <Text style={s.title}>Daily Check-In</Text>
          <Text style={s.subtitle}>
            {checked ? "You're checked in for today!" : 'Tap to check in for today'}
          </Text>
        </View>
        <Pressable
          style={[s.btn, checked && s.btnDone]}
          onPress={handleCheckIn}
          disabled={checked || saving}
        >
          {saving ? (
            <ActivityIndicator color="#0E1117" size="small" />
          ) : (
            <Icon
              name="check-circle"
              size={28}
              color={checked ? '#0E1117' : '#F5A623'}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#1A2035',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  subtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  btn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  btnDone: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A95A3',
    backgroundColor: '#2A3347',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  statusBadgeDone: {
    color: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
});
