/**
 * PlaybookFolderPage — Subscription-program folder drill-in
 *
 * Shows the template playbooks (source-of-truth for each subscription path)
 * and the list of member-specific copies with status badges. Settings panel
 * (slide-up sheet) lets coaches toggle sync, edit the email drip template,
 * manage linked share tokens, and set the music style per subscription path.
 *
 * Phase 4 additions:
 *  - Linked share links quick-nav in settings
 *  - Music-style dropdown per subscription path
 *  - Per-member unsync (Detach from coach updates) in member three-dot menu
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Icon } from './Icon';
import { CONTENT_BOTTOM_CLEARANCE } from '../lib/tabBarStyle';
import type { PlaybookFolder, PlaybookFolderMember, PlaybookFolderMemberStatus, PlaybookFolderSubscriptionPath } from '../lib/types';
import { MUSIC_STYLE_OPTIONS } from '../constants/musicStyles';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const STATUS_COLOR: Record<PlaybookFolderMemberStatus, string> = {
  active: '#34D399',
  paused: '#F59E0B',
  canceled: '#EF4444',
};

const STATUS_LABEL: Record<PlaybookFolderMemberStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  canceled: 'Canceled',
};

interface ShareToken {
  id: string;
  token?: string;
  label?: string;
  url?: string;
}

interface Props {
  folderId: string;
  onBack: () => void;
  onOpenPlaybook: (playbookId: string) => void;
}

export default function PlaybookFolderPage({ folderId, onBack, onOpenPlaybook }: Props) {
  const { effectiveUid, claims, user } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';

  const [folder, setFolder] = useState<PlaybookFolder | null>(null);
  const [members, setMembers] = useState<PlaybookFolderMember[]>([]);
  const [templatePlaybooks, setTemplatePlaybooks] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [editedPaths, setEditedPaths] = useState<PlaybookFolderSubscriptionPath[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  // Linked share tokens
  const [shareTokens, setShareTokens] = useState<ShareToken[]>([]);
  const [newShareTokenInput, setNewShareTokenInput] = useState('');
  const [loadingTokens, setLoadingTokens] = useState(false);

  // Three-dot member menu
  const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Subscribe to the playbook_folder document
  useEffect(() => {
    if (!folderId) return;
    const unsub = onSnapshot(doc(db, 'playbook_folders', folderId), (snap) => {
      if (!snap.exists()) { setLoading(false); return; }
      const data = { id: snap.id, ...snap.data() } as PlaybookFolder;
      setFolder(data);
      setSyncEnabled(data.syncEnabled ?? true);
      setEmailSubject(data.emailTemplate?.subject ?? '');
      setEmailBody(data.emailTemplate?.body ?? '');
      setEditedPaths(data.subscriptionPaths ?? []);
      setLoading(false);
    });
    return unsub;
  }, [folderId]);

  // Subscribe to members
  useEffect(() => {
    if (!folderId || !coachId) return;
    const q = query(
      collection(db, 'playbook_folder_members'),
      where('playbookFolderId', '==', folderId),
      where('coachId', '==', coachId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as PlaybookFolderMember)));
    });
    return unsub;
  }, [folderId, coachId]);

  // Load template playbook names
  useEffect(() => {
    if (!folder?.templatePlaybookIds?.length) { setTemplatePlaybooks([]); return; }
    const ids = folder.templatePlaybookIds;
    getDocs(query(collection(db, 'playbooks'), where('coachId', '==', coachId)))
      .then(snap => {
        const found = snap.docs
          .filter(d => ids.includes(d.id))
          .map(d => ({ id: d.id, name: d.data().name || 'Untitled Playbook' }));
        setTemplatePlaybooks(found);
      })
      .catch(e => console.error('[PlaybookFolderPage] Load templates error:', e));
  }, [folder?.templatePlaybookIds, coachId]);

  // Load linked share tokens when settings opens
  useEffect(() => {
    if (!showSettings || !folder?.linkedShareTokenIds?.length) {
      setShareTokens([]);
      return;
    }
    setLoadingTokens(true);
    const ids = folder.linkedShareTokenIds;
    getDocs(query(collection(db, 'shareTokens'), where('coachId', '==', coachId)))
      .then(snap => {
        const found = snap.docs
          .filter(d => ids.includes(d.id))
          .map(d => ({ id: d.id, ...d.data() } as ShareToken));
        setShareTokens(found);
      })
      .catch(e => console.error('[PlaybookFolderPage] Load share tokens error:', e))
      .finally(() => setLoadingTokens(false));
  }, [showSettings, folder?.linkedShareTokenIds, coachId]);

  const saveSettings = useCallback(async () => {
    if (!folderId) return;
    setSavingSettings(true);
    try {
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        syncEnabled,
        emailTemplate: { subject: emailSubject.trim(), body: emailBody.trim() },
        subscriptionPaths: editedPaths,
        updatedAt: serverTimestamp(),
      });
      setShowSettings(false);
    } catch (e) {
      console.error('[PlaybookFolderPage] Save settings error:', e);
    } finally {
      setSavingSettings(false);
    }
  }, [folderId, syncEnabled, emailSubject, emailBody, editedPaths]);

  const updateMemberStatus = useCallback(async (memberId: string, status: PlaybookFolderMemberStatus) => {
    try {
      await updateDoc(doc(db, 'playbook_folder_members', memberId), {
        status,
        pausedReason: status === 'paused' ? 'Coach-initiated pause' : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[PlaybookFolderPage] Update member status error:', e);
    }
    setMemberMenuId(null);
  }, []);

  const detachMemberPlaybook = useCallback(async (member: PlaybookFolderMember) => {
    setMemberMenuId(null);
    if (!member.duplicatedPlaybookId) return;
    try {
      const fn = httpsCallable(functions, 'unsyncMemberPlaybook');
      await fn({ playbookId: member.duplicatedPlaybookId });
    } catch (e) {
      console.error('[PlaybookFolderPage] Unsync error:', e);
      Alert.alert('Error', 'Could not detach playbook from updates. Try again.');
    }
  }, []);

  const linkShareToken = useCallback(async () => {
    const raw = newShareTokenInput.trim();
    if (!raw || !folderId) return;
    // Accept either a full URL (extract last segment) or bare ID
    const tokenId = raw.includes('/') ? raw.split('/').filter(Boolean).pop()! : raw;
    try {
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        linkedShareTokenIds: arrayUnion(tokenId),
        updatedAt: serverTimestamp(),
      });
      setNewShareTokenInput('');
    } catch (e) {
      console.error('[PlaybookFolderPage] Link share token error:', e);
    }
  }, [folderId, newShareTokenInput]);

  const unlinkShareToken = useCallback(async (tokenId: string) => {
    if (!folderId) return;
    try {
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        linkedShareTokenIds: arrayRemove(tokenId),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[PlaybookFolderPage] Unlink share token error:', e);
    }
  }, [folderId]);

  const updatePathMusicStyle = useCallback((pathId: string, musicStyle: string) => {
    setEditedPaths(prev => prev.map(p => p.id === pathId ? { ...p, musicStyle } : p));
  }, []);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#A78BFA" />
      </View>
    );
  }

  if (!folder) {
    return (
      <View style={s.center}>
        <Text style={s.emptyText}>Folder not found.</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={onBack} style={s.backBtn} hitSlop={12}>
          <Icon name="chevron-left" size={22} color="#F0F4F8" />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>{folder.name}</Text>
        <Pressable onPress={() => setShowSettings(true)} style={s.settingsBtn} hitSlop={12}>
          <Icon name="settings" size={20} color="#8A95A3" />
        </Pressable>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: CONTENT_BOTTOM_CLEARANCE + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Template Playbooks section */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Template Playbooks</Text>
          {templatePlaybooks.length === 0 ? (
            <Text style={s.emptyText}>No template playbooks yet.</Text>
          ) : (
            templatePlaybooks.map(pb => (
              <Pressable
                key={pb.id}
                style={s.templateRow}
                onPress={() => onOpenPlaybook(pb.id)}
              >
                <Icon name="playbook" size={18} color="#A78BFA" />
                <Text style={s.templateName} numberOfLines={1}>{pb.name}</Text>
                <Icon name="chevron-right" size={16} color="#4A5568" />
              </Pressable>
            ))
          )}
        </View>

        {/* Members section */}
        <View style={s.section}>
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>
              Members{members.length > 0 ? ` (${members.length})` : ''}
            </Text>
            <Pressable
              style={s.addMemberBtn}
              onPress={() => setShowComingSoon(true)}
            >
              <Icon name="plus" size={14} color="#A78BFA" />
              <Text style={s.addMemberText}>Add member</Text>
            </Pressable>
          </View>

          {/* Search */}
          {members.length > 3 && (
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search members..."
              placeholderTextColor="#4A5568"
            />
          )}

          {filteredMembers.length === 0 ? (
            <Text style={s.emptyText}>
              {members.length === 0 ? 'No members yet. Add the first member to get started.' : 'No members match your search.'}
            </Text>
          ) : (
            filteredMembers.map(member => (
              <View key={member.id} style={s.memberRow}>
                <View style={s.memberInfo}>
                  <Text style={s.memberName} numberOfLines={1}>{member.name}</Text>
                  <Text style={s.memberEmail} numberOfLines={1}>{member.email}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: STATUS_COLOR[member.status] + '22' }]}>
                  <Text style={[s.statusText, { color: STATUS_COLOR[member.status] }]}>
                    {STATUS_LABEL[member.status]}
                  </Text>
                </View>
                <Pressable
                  style={s.memberMenuBtn}
                  hitSlop={10}
                  onPress={() => setMemberMenuId(prev => prev === member.id ? null : member.id)}
                >
                  <Icon name="more-vertical" size={18} color="#8A95A3" />
                </Pressable>

                {/* Inline three-dot menu */}
                {memberMenuId === member.id && (
                  <View style={s.memberMenu}>
                    <Pressable
                      style={s.memberMenuItem}
                      onPress={() => { onOpenPlaybook(member.duplicatedPlaybookId); setMemberMenuId(null); }}
                    >
                      <Icon name="playbook" size={15} color="#A78BFA" />
                      <Text style={s.memberMenuText}>View playbook</Text>
                    </Pressable>
                    <Pressable
                      style={s.memberMenuItem}
                      onPress={() => detachMemberPlaybook(member)}
                    >
                      <Icon name="x" size={15} color="#8A95A3" />
                      <Text style={[s.memberMenuText, { color: '#8A95A3' }]}>Detach from updates</Text>
                    </Pressable>
                    {member.status === 'active' && (
                      <Pressable
                        style={s.memberMenuItem}
                        onPress={() => updateMemberStatus(member.id, 'paused')}
                      >
                        <Icon name="pause" size={15} color="#F59E0B" />
                        <Text style={[s.memberMenuText, { color: '#F59E0B' }]}>Pause</Text>
                      </Pressable>
                    )}
                    {member.status === 'paused' && (
                      <Pressable
                        style={s.memberMenuItem}
                        onPress={() => updateMemberStatus(member.id, 'active')}
                      >
                        <Icon name="play" size={15} color="#34D399" />
                        <Text style={[s.memberMenuText, { color: '#34D399' }]}>Resume</Text>
                      </Pressable>
                    )}
                    {member.status !== 'canceled' && (
                      <Pressable
                        style={s.memberMenuItem}
                        onPress={() => updateMemberStatus(member.id, 'canceled')}
                      >
                        <Icon name="x" size={15} color="#EF4444" />
                        <Text style={[s.memberMenuText, { color: '#EF4444' }]}>Cancel</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Settings sheet */}
      <Modal
        transparent
        visible={showSettings}
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <Pressable style={s.sheetOverlay} onPress={() => setShowSettings(false)}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={s.sheetHandle} />
              <Text style={s.sheetTitle}>Settings</Text>

              {/* Sync toggle */}
              <View style={s.settingRow}>
                <View style={s.settingInfo}>
                  <Text style={s.settingLabel}>Sync enabled</Text>
                  <Text style={s.settingDesc}>
                    Member copies automatically update when the template changes.
                  </Text>
                </View>
                <Switch
                  value={syncEnabled}
                  onValueChange={setSyncEnabled}
                  trackColor={{ false: '#2D3748', true: '#7C3AED' }}
                  thumbColor="#fff"
                />
              </View>

              {/* Subscription paths — music style per path */}
              {editedPaths.length > 0 && (
                <>
                  <Text style={s.sheetSubtitle}>Subscription paths</Text>
                  {editedPaths.map(path => (
                    <View key={path.id} style={s.pathRow}>
                      <Text style={s.pathLabel} numberOfLines={1}>{path.label || 'Unnamed path'}</Text>
                      <Text style={s.pathFieldLabel}>Music style</Text>
                      <View style={s.pickerRow}>
                        {MUSIC_STYLE_OPTIONS.slice(0, 6).map(opt => (
                          <Pressable
                            key={opt.value}
                            style={[
                              s.musicChip,
                              path.musicStyle === opt.value && s.musicChipActive,
                            ]}
                            onPress={() => updatePathMusicStyle(path.id, opt.value)}
                          >
                            <Text style={[
                              s.musicChipText,
                              path.musicStyle === opt.value && s.musicChipTextActive,
                            ]}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View style={s.pickerRow}>
                        {MUSIC_STYLE_OPTIONS.slice(6).map(opt => (
                          <Pressable
                            key={opt.value}
                            style={[
                              s.musicChip,
                              path.musicStyle === opt.value && s.musicChipActive,
                            ]}
                            onPress={() => updatePathMusicStyle(path.id, opt.value)}
                          >
                            <Text style={[
                              s.musicChipText,
                              path.musicStyle === opt.value && s.musicChipTextActive,
                            ]}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Email template */}
              <Text style={s.sheetSubtitle}>Email drip template</Text>
              <Text style={s.settingDesc}>
                Use {'{{firstName}}'} as a placeholder for the member's name.
              </Text>
              <TextInput
                style={[s.textField, { marginTop: 8 }]}
                value={emailSubject}
                onChangeText={setEmailSubject}
                placeholder="Subject line..."
                placeholderTextColor="#4A5568"
              />
              <TextInput
                style={[s.textField, s.textArea]}
                value={emailBody}
                onChangeText={setEmailBody}
                placeholder="Email body..."
                placeholderTextColor="#4A5568"
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />

              {/* Linked share links */}
              <Text style={s.sheetSubtitle}>Linked share links</Text>
              <Text style={s.settingDesc}>
                Members who enroll through these share links are automatically added to this folder.
              </Text>

              {loadingTokens ? (
                <ActivityIndicator color="#A78BFA" style={{ marginVertical: 8 }} />
              ) : shareTokens.length === 0 ? (
                <Text style={[s.emptyText, { marginTop: 6 }]}>No linked share links yet.</Text>
              ) : (
                shareTokens.map(token => {
                  const shareUrl = token.url || `https://goarrive.fit/share/${token.id}`;
                  return (
                    <View key={token.id} style={s.tokenRow}>
                      <Text style={s.tokenLabel} numberOfLines={1}>
                        {token.label || shareUrl}
                      </Text>
                      <Pressable
                        style={s.tokenBtn}
                        hitSlop={8}
                        onPress={() => Linking.openURL(shareUrl)}
                      >
                        <Text style={s.tokenBtnText}>Open</Text>
                      </Pressable>
                      <Pressable
                        style={[s.tokenBtn, s.tokenBtnDestructive]}
                        hitSlop={8}
                        onPress={() => unlinkShareToken(token.id)}
                      >
                        <Text style={[s.tokenBtnText, { color: '#EF4444' }]}>Unlink</Text>
                      </Pressable>
                    </View>
                  );
                })
              )}

              <View style={s.tokenAddRow}>
                <TextInput
                  style={[s.textField, s.tokenInput]}
                  value={newShareTokenInput}
                  onChangeText={setNewShareTokenInput}
                  placeholder="Paste share token ID or URL..."
                  placeholderTextColor="#4A5568"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={s.tokenAddBtn}
                  onPress={linkShareToken}
                  disabled={!newShareTokenInput.trim()}
                >
                  <Text style={s.tokenAddBtnText}>Add</Text>
                </Pressable>
              </View>

              <Pressable
                style={[s.saveBtn, savingSettings && { opacity: 0.6 }]}
                onPress={saveSettings}
                disabled={savingSettings}
              >
                <Text style={s.saveBtnText}>{savingSettings ? 'Saving...' : 'Save'}</Text>
              </Pressable>

              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Coming soon modal (enrollment stub) */}
      <Modal
        transparent
        visible={showComingSoon}
        animationType="fade"
        onRequestClose={() => setShowComingSoon(false)}
      >
        <Pressable style={s.sheetOverlay} onPress={() => setShowComingSoon(false)}>
          <Pressable style={[s.sheet, { paddingBottom: 32 }]} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <Icon name="calendar" size={32} color="#A78BFA" style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={[s.sheetTitle, { textAlign: 'center' }]}>Coming Soon</Text>
            <Text style={[s.settingDesc, { textAlign: 'center', marginTop: 8 }]}>
              Subscription enrollment is coming in Phase 4. For now, members are added automatically when they subscribe via a share link.
            </Text>
            <Pressable style={[s.saveBtn, { marginTop: 24 }]} onPress={() => setShowComingSoon(false)}>
              <Text style={s.saveBtnText}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  center: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E2A3A',
  },
  backBtn: {
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontFamily: FH,
    fontSize: 17,
    color: '#F0F4F8',
  },
  settingsBtn: {
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    flex: 1,
    fontFamily: FH,
    fontSize: 13,
    color: '#8A95A3',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  addMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A78BFA44',
  },
  addMemberText: {
    fontFamily: FB,
    fontSize: 12,
    color: '#A78BFA',
  },
  searchInput: {
    backgroundColor: '#1A2332',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
    marginBottom: 12,
  },
  emptyText: {
    fontFamily: FB,
    fontSize: 13,
    color: '#4A5568',
    marginBottom: 12,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#141024',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#4C3D8F',
  },
  templateName: {
    flex: 1,
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131B26',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    position: 'relative',
  },
  memberInfo: {
    flex: 1,
    marginRight: 8,
  },
  memberName: {
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
    marginBottom: 2,
  },
  memberEmail: {
    fontFamily: FB,
    fontSize: 12,
    color: '#8A95A3',
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 8,
  },
  statusText: {
    fontFamily: FB,
    fontSize: 11,
    fontWeight: '600',
  },
  memberMenuBtn: {
    padding: 4,
  },
  memberMenu: {
    position: 'absolute',
    right: 14,
    top: '100%',
    backgroundColor: '#1A2332',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
    zIndex: 10,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  memberMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  memberMenuText: {
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
  },
  // Settings sheet
  sheetOverlay: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#131B26',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#2D3748',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: FH,
    fontSize: 18,
    color: '#F0F4F8',
    marginBottom: 20,
  },
  sheetSubtitle: {
    fontFamily: FH,
    fontSize: 14,
    color: '#8A95A3',
    marginTop: 20,
    marginBottom: 10,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E2A3A',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
    marginBottom: 2,
  },
  settingDesc: {
    fontFamily: FB,
    fontSize: 12,
    color: '#8A95A3',
    lineHeight: 17,
  },
  textField: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FB,
    fontSize: 14,
    color: '#F0F4F8',
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  textArea: {
    minHeight: 120,
  },
  saveBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    fontFamily: FH,
    fontSize: 15,
    color: '#fff',
  },
  // Subscription path rows
  pathRow: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  pathLabel: {
    fontFamily: FH,
    fontSize: 13,
    color: '#F0F4F8',
    marginBottom: 8,
  },
  pathFieldLabel: {
    fontFamily: FB,
    fontSize: 11,
    color: '#8A95A3',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  musicChip: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1A2332',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  musicChipActive: {
    backgroundColor: '#7C3AED22',
    borderColor: '#7C3AED',
  },
  musicChipText: {
    fontFamily: FB,
    fontSize: 12,
    color: '#8A95A3',
  },
  musicChipTextActive: {
    color: '#A78BFA',
    fontWeight: '600',
  },
  // Share token rows
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
    gap: 6,
  },
  tokenLabel: {
    flex: 1,
    fontFamily: FB,
    fontSize: 12,
    color: '#8A95A3',
  },
  tokenBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  tokenBtnDestructive: {
    borderColor: '#EF444444',
  },
  tokenBtnText: {
    fontFamily: FB,
    fontSize: 12,
    color: '#A78BFA',
  },
  tokenAddRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  tokenInput: {
    flex: 1,
    marginBottom: 0,
  },
  tokenAddBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tokenAddBtnText: {
    fontFamily: FH,
    fontSize: 13,
    color: '#fff',
  },
});
