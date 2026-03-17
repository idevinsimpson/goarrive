/**
 * AccountPanel — Slide-over profile panel for GoArrive
 *
 * Renders as a Modal overlay that slides up from the bottom.
 * Replaces the full-page account navigation so the user stays
 * in context on whatever screen they were on.
 *
 * Usage:
 *   <AccountPanel visible={showAccount} onClose={() => setShowAccount(false)} />
 */
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { Icon } from './Icon';
import { useAuth } from '../lib/AuthContext';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AccountPanel({ visible, onClose }: Props) {
  const { user, claims, signOut } = useAuth();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const displayName = user?.displayName ?? user?.email ?? 'User';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    onClose();
    // Small delay so panel closes before auth state changes
    setTimeout(() => signOut(), 200);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={onClose} />

      {/* Panel */}
      <Animated.View
        style={[s.panel, { transform: [{ translateY: slideAnim }] }]}
      >
        {/* Handle bar */}
        <View style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        {/* Header row */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Account</Text>
          <Pressable onPress={onClose} hitSlop={12} style={s.closeBtn}>
            <Icon name="x" size={20} color="#8A95A3" />
          </Pressable>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <View style={s.avatarWrap}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <Text style={s.name}>{displayName}</Text>
            <Text style={s.email}>{user?.email ?? '—'}</Text>
          </View>

          {/* Info cards */}
          <View style={s.card}>
            <Text style={s.cardLabel}>Role</Text>
            <Text style={s.cardValue}>{claims?.role ?? 'coach'}</Text>
          </View>
          {claims?.coachId && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Coach ID</Text>
              <Text style={s.cardValue} numberOfLines={1}>{claims.coachId}</Text>
            </View>
          )}
          {claims?.tenantId && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Tenant ID</Text>
              <Text style={s.cardValue} numberOfLines={1}>{claims.tenantId}</Text>
            </View>
          )}

          {/* Sign out */}
          <Pressable style={s.signOutBtn} onPress={handleSignOut}>
            <Icon name="logout" size={18} color="#E05252" />
            <Text style={s.signOutText}>Sign Out</Text>
          </Pressable>

          {/* Bottom safe area spacer */}
          <View style={s.bottomSpacer} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#131A27',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 20,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A3347',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 12,
    alignItems: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    gap: 8,
    marginVertical: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  email: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1A2035',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cardLabel: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    maxWidth: '60%',
    textAlign: 'right',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(224,82,82,0.08)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
    marginTop: 8,
    width: '100%',
    maxWidth: 400,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E05252',
    fontFamily: FONT_BODY,
  },
  bottomSpacer: {
    height: Platform.select({ ios: 32, default: 16 }),
    ...(Platform.OS === 'web'
      ? ({ height: 'max(16px, env(safe-area-inset-bottom, 16px))' as any } as any)
      : {}),
  },
});
