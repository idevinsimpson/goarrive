/**
 * CheckInCard — Daily habit check-in card for the Dashboard
 *
 * Shows the current day's check-in status with a tap-to-complete button.
 * Reads/writes from the check_ins Firestore collection.
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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CheckInCard() {
  const { user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadToday();
  }, [user]);

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
              name={checked ? 'check-circle' : 'check-circle'}
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
});
