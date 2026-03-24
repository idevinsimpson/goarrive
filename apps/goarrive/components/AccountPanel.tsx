/**
 * AccountPanel — Right-side slide-in drawer for GoArrive
 *
 * Slides in from the right edge when the DS avatar is tapped.
 * Shows user profile info at the top, then a menu of options:
 *   - Settings (stub for now)
 *   - Help & Feedback (stub)
 *   - Sign Out
 *
 * Usage:
 *   <AccountPanel visible={showAccount} onClose={() => setShowAccount(false)} />
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Modal,
  Animated,
  Dimensions,
  TextInput,
  ScrollView,
} from 'react-native';
import { Icon } from './Icon';
import { useAuth } from '../lib/AuthContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { router } from 'expo-router';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320);

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface MenuItem {
  icon: string;
  label: string;
  sublabel?: string;
  onPress: () => void;
  danger?: boolean;
}

export default function AccountPanel({ visible, onClose }: Props) {
  const { user, claims, signOut } = useAuth();
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2800);
  }

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 70,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: PANEL_WIDTH,
        duration: 240,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const [zoomEmail, setZoomEmail] = useState('');
  const [zoomLabel, setZoomLabel] = useState('');
  const [zoomSaved, setZoomSaved] = useState(false);
  const [zoomLoading, setZoomLoading] = useState(false);
  const [showZoom, setShowZoom] = useState(false);

  // Load coach's personal Zoom from coach_brands on mount
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const brandDoc = await getDoc(doc(db, 'coach_brands', user.uid));
        if (brandDoc.exists()) {
          const data = brandDoc.data();
          if (data.personalZoom) {
            setZoomEmail(data.personalZoom.email || '');
            setZoomLabel(data.personalZoom.label || '');
            setZoomSaved(!!data.personalZoom.email);
          }
        }
      } catch (e) {
        console.warn('Failed to load personal Zoom:', e);
      }
    })();
  }, [user?.uid]);

  async function handleSaveZoom() {
    if (!user?.uid || !zoomEmail.trim()) return;
    setZoomLoading(true);
    try {
      // Save to coach_brands
      await setDoc(doc(db, 'coach_brands', user.uid), {
        personalZoom: {
          email: zoomEmail.trim(),
          label: zoomLabel.trim() || 'My Zoom',
        },
      }, { merge: true });

      // Also register as a zoom_room with isPersonal: true via Cloud Function
      const functions = getFunctions();
      const manageZoomRoom = httpsCallable(functions, 'manageZoomRoom');
      await manageZoomRoom({
        action: 'add',
        label: zoomLabel.trim() || 'My Zoom',
        zoomAccountEmail: zoomEmail.trim(),
        isPersonal: true,
      });

      setZoomSaved(true);
      showToast('Personal Zoom saved!');
    } catch (e: any) {
      console.error('Failed to save Zoom:', e);
      showToast('Failed to save — try again');
    } finally {
      setZoomLoading(false);
    }
  }

  const displayName = user?.displayName ?? user?.email?.split('@')[0] ?? 'User';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const role = claims?.role ?? 'coach';
  const roleLabel = 
    role === 'platformAdmin' ? 'Platform Admin' : 
    role === 'coachAssistant' ? 'Coach Assistant' : 
    role === 'member' ? 'Member' : 
    'Coach';

  async function handleSignOut() {
    onClose();
    setTimeout(() => signOut(), 240);
  }

  function handleSettings() {
    showToast('Settings coming soon — stay tuned!');
  }

  function handleHelp() {
    showToast('Need help? Email us at support@goarrive.com');
  }

  function handleFeedback() {
    // Open feedback/bug report form in a new tab (or in-app browser)
    const url = 'https://forms.gle/GoArriveFeedback'; // placeholder — update with real form URL
    if (Platform.OS === 'web') {
      window.open('mailto:support@goa.fit?subject=GoArrive%20Beta%20Feedback&body=Page%3A%20%0A%0AWhat%20happened%3A%20%0A%0AExpected%3A%20%0A%0ADevice%3A%20', '_blank');
    } else {
      showToast('Send feedback to: support@goa.fit');
    }
    onClose();
  }

  const menuItems: MenuItem[] = [
    {
      icon: 'settings',
      label: 'Settings',
      sublabel: 'App preferences & notifications',
      onPress: handleSettings,
    },
    {
      icon: 'help-circle',
      label: 'Help & Support',
      sublabel: 'Get help or contact us',
      onPress: handleHelp,
    },
    {
      icon: 'edit',
      label: 'Report a Bug / Suggest',
      sublabel: 'Share feedback or screenshots to support@goa.fit',
      onPress: handleFeedback,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — tap to close */}
      <Pressable style={s.backdrop} onPress={onClose} />

      {/* Right-side panel */}
      <Animated.View
        style={[s.panel, { transform: [{ translateX: slideAnim }] }]}
      >
        {/* Profile section */}
        <View style={s.profileSection}>
          <View style={s.avatarRow}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
              <Icon name="x" size={20} color="#8A95A3" />
            </Pressable>
          </View>
          <Text style={s.name} numberOfLines={1}>{displayName}</Text>
          <Text style={s.email} numberOfLines={1}>{user?.email ?? '—'}</Text>
          <View style={s.roleBadge}>
            <Text style={s.roleText}>{roleLabel}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* Menu items */}
        <ScrollView style={{ flex: 1 }} bounces={false}>
        <View style={s.menu}>
          {menuItems.map((item) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
              onPress={item.onPress}
            >
              <View style={s.menuIconWrap}>
                <Icon name={item.icon} size={20} color="#8A95A3" />
              </View>
              <View style={s.menuTextWrap}>
                <Text style={[s.menuLabel, item.danger && s.menuLabelDanger]}>
                  {item.label}
                </Text>
                {item.sublabel && (
                  <Text style={s.menuSublabel}>{item.sublabel}</Text>
                )}
              </View>
              <Icon name="chevron-right" size={16} color="#4A5568" />
            </Pressable>
          ))}
        </View>

        {/* Divider */}
        <View style={s.divider} />

        {/* My Zoom Account */}
        <Pressable
          style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
          onPress={() => setShowZoom(!showZoom)}
        >
          <View style={s.menuIconWrap}>
            <Icon name="video" size={20} color={zoomSaved ? '#6EBB7A' : '#8A95A3'} />
          </View>
          <View style={s.menuTextWrap}>
            <Text style={s.menuLabel}>My Zoom Account</Text>
            <Text style={s.menuSublabel}>
              {zoomSaved ? zoomEmail : 'Connect your personal Zoom'}
            </Text>
          </View>
          <Icon name={showZoom ? 'chevron-down' : 'chevron-right'} size={16} color="#4A5568" />
        </Pressable>

        {showZoom && (
          <View style={s.zoomSection}>
            <Text style={s.zoomHint}>
              This Zoom is used for Coach Guided sessions where you join live with your member.
            </Text>
            <TextInput
              style={s.zoomInput}
              placeholder="Zoom account email"
              placeholderTextColor="#5A6478"
              value={zoomEmail}
              onChangeText={setZoomEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={s.zoomInput}
              placeholder='Label (e.g. "My Zoom")'
              placeholderTextColor="#5A6478"
              value={zoomLabel}
              onChangeText={setZoomLabel}
            />
            <Pressable
              style={[s.zoomSaveBtn, zoomLoading && { opacity: 0.5 }]}
              onPress={handleSaveZoom}
              disabled={zoomLoading || !zoomEmail.trim()}
            >
              <Text style={s.zoomSaveBtnText}>
                {zoomLoading ? 'Saving...' : zoomSaved ? 'Update Zoom' : 'Connect Zoom'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Admin link — only visible to platformAdmin */}
        {(claims?.admin === true || claims?.role === 'platformAdmin') && (
          <>
            <View style={s.divider} />
            <Pressable
              style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}
              onPress={() => { onClose(); setTimeout(() => router.push('/(app)/admin'), 240); }}
            >
              <View style={s.menuIconWrap}>
                <Icon name="settings" size={20} color="#F5A623" />
              </View>
              <View style={s.menuTextWrap}>
                <Text style={s.menuLabel}>Admin</Text>
                <Text style={s.menuSublabel}>Operations center & coach management</Text>
              </View>
              <Icon name="chevron-right" size={16} color="#4A5568" />
            </Pressable>
          </>
        )}

        {/* Divider */}
        <View style={s.divider} />

        {/* Sign out */}
        <Pressable
          style={({ pressed }) => [s.signOutBtn, pressed && s.signOutBtnPressed]}
          onPress={handleSignOut}
        >
          <View style={s.menuIconWrap}>
            <Icon name="logout" size={20} color="#E05252" />
          </View>
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>

        {/* In-panel toast */}
        {!!toastMsg && (
          <View style={s.toast}>
            <Text style={s.toastText}>{toastMsg}</Text>
          </View>
        )}

        </ScrollView>

      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.50)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: '#0F1623',
    shadowColor: '#000',
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 24,
  },
  profileSection: {
    paddingTop: Platform.OS === 'web' ? ('max(48px, env(safe-area-inset-top, 48px))' as any) : Platform.OS === 'ios' ? 60 : 48,
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#131A27',
  },
  avatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  closeBtn: {
    padding: 6,
    marginTop: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    marginBottom: 3,
  },
  email: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginBottom: 10,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_BODY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E2A3A',
    marginHorizontal: 0,
  },
  menu: {
    paddingVertical: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  menuItemPressed: {
    backgroundColor: '#1A2035',
  },
  menuIconWrap: {
    width: 32,
    alignItems: 'center',
  },
  menuTextWrap: {
    flex: 1,
    gap: 2,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#D0D8E4',
    fontFamily: FONT_BODY,
  },
  menuLabelDanger: {
    color: '#E05252',
  },
  menuSublabel: {
    fontSize: 12,
    color: '#5A6478',
    fontFamily: FONT_BODY,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  signOutBtnPressed: {
    backgroundColor: 'rgba(224,82,82,0.06)',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#E05252',
    fontFamily: FONT_BODY,
  },
  toast: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  toastText: {
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    lineHeight: 18,
  },
  bottomSpacer: {
    height: Platform.select({ ios: 32, default: 16 }),
    ...(Platform.OS === 'web'
      ? ({ height: 'max(16px, env(safe-area-inset-bottom, 16px))' as any } as any)
      : {}),
  },
  zoomSection: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(110,187,122,0.04)',
    gap: 10,
  },
  zoomHint: {
    fontSize: 12,
    color: '#6A7585',
    fontFamily: FONT_BODY,
    lineHeight: 17,
  },
  zoomInput: {
    backgroundColor: '#1A2035',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    borderWidth: 1,
    borderColor: '#2A3548',
  },
  zoomSaveBtn: {
    backgroundColor: '#6EBB7A',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  zoomSaveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0A0F1A',
    fontFamily: FONT_BODY,
  },
});
