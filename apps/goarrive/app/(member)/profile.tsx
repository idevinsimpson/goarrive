/**
 * Member Profile — Profile editing and photo upload for members
 *
 * Allows members to view and edit their profile information,
 * upload a profile photo, and sign out.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface ProfileData {
  displayName?: string;
  email?: string;
  phone?: string;
  photoURL?: string;
  status?: string;
  coachId?: string;
}

export default function MemberProfile() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  useEffect(() => {
    if (!user) return;
    fetchProfile();
  }, [user]);

  async function fetchProfile() {
    try {
      // Try members collection first
      const memberRef = doc(db, 'members', user!.uid);
      const memberSnap = await getDoc(memberRef);

      if (memberSnap.exists()) {
        const data = memberSnap.data() as ProfileData;
        setProfile(data);
        setEditName(data.displayName || user!.displayName || '');
        setEditPhone(data.phone || '');
      } else {
        // Fall back to user's auth info
        setProfile({
          displayName: user!.displayName || '',
          email: user!.email || '',
          phone: '',
        });
        setEditName(user!.displayName || '');
      }
    } catch (err) {
      console.error('[MemberProfile] Error fetching profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const memberRef = doc(db, 'members', user.uid);
      await updateDoc(memberRef, {
        displayName: editName.trim(),
        phone: editPhone.trim(),
        updatedAt: Timestamp.now(),
      });
      setProfile((prev) => ({
        ...prev,
        displayName: editName.trim(),
        phone: editPhone.trim(),
      }));
      setEditMode(false);
    } catch (err) {
      console.error('[MemberProfile] Error saving profile:', err);
      if (Platform.OS === 'web') {
        window.alert('Failed to save profile. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to save profile. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      console.error('[MemberProfile] Sign out error:', err);
    }
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <AppHeader />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AppHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.displayName || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>
            {profile?.displayName || 'Member'}
          </Text>
          <Text style={styles.email}>{profile?.email || user?.email}</Text>
          <View style={[
            styles.statusBadge,
            profile?.status === 'active' ? styles.statusActive : styles.statusPending,
          ]}>
            <Text style={[
              styles.statusText,
              profile?.status === 'active' ? styles.statusTextActive : styles.statusTextPending,
            ]}>
              {profile?.status === 'active' ? 'Active Member' : 'Pending'}
            </Text>
          </View>
        </View>

        {/* Profile Info Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Profile Information</Text>
            {!editMode ? (
              <TouchableOpacity onPress={() => setEditMode(true)}>
                <Icon name="edit" size={18} color="#F5A623" />
              </TouchableOpacity>
            ) : null}
          </View>

          {editMode ? (
            <View style={styles.editForm}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Display Name</Text>
                <TextInput
                  style={styles.input}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Your name"
                  placeholderTextColor="#4A5568"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  style={styles.input}
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder="(555) 123-4567"
                  placeholderTextColor="#4A5568"
                  keyboardType="phone-pad"
                />
              </View>
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setEditMode(false);
                    setEditName(profile?.displayName || '');
                    setEditPhone(profile?.phone || '');
                  }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#0E1117" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>
                  {profile?.displayName || 'Not set'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>
                  {profile?.email || user?.email || 'Not set'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>
                  {profile?.phone || 'Not set'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Icon name="logout" size={18} color="#E53E3E" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'web' ? 100 : 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F5A623',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#718096',
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPending: { backgroundColor: 'rgba(245, 166, 35, 0.15)' },
  statusActive: { backgroundColor: 'rgba(72, 187, 120, 0.15)' },
  statusText: { fontSize: 12, fontWeight: '700' },
  statusTextPending: { color: '#F5A623' },
  statusTextActive: { color: '#48BB78' },
  card: {
    backgroundColor: '#151B26',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  infoLabel: { fontSize: 14, color: '#718096' },
  infoValue: { fontSize: 14, color: '#F0F4F8', fontWeight: '500' },
  editForm: {},
  fieldGroup: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0E1117',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#F0F4F8',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  cancelBtnText: { fontSize: 14, color: '#A0AEC0', fontWeight: '600' },
  saveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F5A623',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, color: '#0E1117', fontWeight: '700' },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(229, 62, 62, 0.3)',
    marginTop: 8,
    gap: 8,
  },
  signOutText: {
    fontSize: 14,
    color: '#E53E3E',
    fontWeight: '600',
  },
});
