/**
 * PlaybookFolderPage — Subscription-program folder drill-in
 *
 * Shows the template playbooks (source-of-truth for each subscription path)
 * and the list of member-specific copies with status badges. Settings panel
 * (slide-up sheet) lets coaches toggle sync and edit the email drip template.
 *
 * Phase 3 — subscription enrollment is stubbed behind a "coming soon" modal.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { db } from '../lib/firebase';
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
  const [savingSettings, setSavingSettings] = useState(false);

  // Subscription paths editor
  const [showAddPath, setShowAddPath] = useState(false);
  const [newPathLabel, setNewPathLabel] = useState('');
  const [newPathTemplateId, setNewPathTemplateId] = useState('');
  const [newPathMusicStyle, setNewPathMusicStyle] = useState('');
  const [newPathPriceDollars, setNewPathPriceDollars] = useState('');
  const [savingPath, setSavingPath] = useState(false);

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

  const saveSettings = useCallback(async () => {
    if (!folderId) return;
    setSavingSettings(true);
    try {
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        syncEnabled,
        emailTemplate: { subject: emailSubject.trim(), body: emailBody.trim() },
        updatedAt: serverTimestamp(),
      });
      setShowSettings(false);
    } catch (e) {
      console.error('[PlaybookFolderPage] Save settings error:', e);
    } finally {
      setSavingSettings(false);
    }
  }, [folderId, syncEnabled, emailSubject, emailBody]);

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

  const addSubscriptionPath = useCallback(async () => {
    if (!folderId || !newPathLabel.trim()) return;
    setSavingPath(true);
    try {
      const existing: PlaybookFolderSubscriptionPath[] = folder?.subscriptionPaths ?? [];
      const priceDollars = parseFloat(newPathPriceDollars);
      const pricePerMonthCents = Number.isFinite(priceDollars) && priceDollars > 0
        ? Math.round(priceDollars * 100)
        : undefined;
      const newPath: PlaybookFolderSubscriptionPath = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        label: newPathLabel.trim(),
        templatePlaybookId: newPathTemplateId,
        musicStyle: newPathMusicStyle || undefined,
        pricePerMonthCents,
      };
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        subscriptionPaths: [...existing, newPath],
        updatedAt: serverTimestamp(),
      });
      setNewPathLabel('');
      setNewPathTemplateId('');
      setNewPathMusicStyle('');
      setNewPathPriceDollars('');
      setShowAddPath(false);
    } catch (e) {
      console.error('[PlaybookFolderPage] Add path error:', e);
    } finally {
      setSavingPath(false);
    }
  }, [folderId, folder?.subscriptionPaths, newPathLabel, newPathTemplateId, newPathMusicStyle, newPathPriceDollars]);

  const deleteSubscriptionPath = useCallback(async (pathId: string) => {
    if (!folderId) return;
    try {
      const existing: PlaybookFolderSubscriptionPath[] = folder?.subscriptionPaths ?? [];
      await updateDoc(doc(db, 'playbook_folders', folderId), {
        subscriptionPaths: existing.filter((p) => p.id !== pathId),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[PlaybookFolderPage] Delete path error:', e);
    }
  }, [folderId, folder?.subscriptionPaths]);

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

            {/* Email template */}
            <Text style={s.sheetSubtitle}>Email drip template</Text>
            <TextInput
              style={s.textField}
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

            {/* Subscription paths editor */}
            <Text style={s.sheetSubtitle}>Program Paths</Text>
            <Text style={[s.settingDesc, { marginBottom: 10 }]}>
              Each path maps to a template playbook and appears as a choice during member onboarding.
            </Text>

            {(folder.subscriptionPaths ?? []).map((path) => (
              <View key={path.id} style={s.pathRow}>
                <Text style={s.pathRowLabel} numberOfLines={1}>{path.label}</Text>
                <Pressable hitSlop={8} onPress={() => deleteSubscriptionPath(path.id)}>
                  <Text style={s.pathDeleteText}>Remove</Text>
                </Pressable>
              </View>
            ))}

            {showAddPath ? (
              <View style={s.addPathForm}>
                <TextInput
                  style={s.textField}
                  value={newPathLabel}
                  onChangeText={setNewPathLabel}
                  placeholder="Path label (e.g. Beginner, Full Gym)"
                  placeholderTextColor="#4A5568"
                />
                <Text style={[s.settingDesc, { marginBottom: 6 }]}>Template playbook</Text>
                {templatePlaybooks.length === 0 ? (
                  <Text style={[s.settingDesc, { marginBottom: 10 }]}>No template playbooks — add one first.</Text>
                ) : (
                  <View style={s.pickerRow}>
                    {templatePlaybooks.map((pb) => (
                      <Pressable
                        key={pb.id}
                        style={[s.pickerChip, newPathTemplateId === pb.id ? s.pickerChipActive : {}]}
                        onPress={() => setNewPathTemplateId(pb.id)}
                      >
                        <Text style={[s.pickerChipText, newPathTemplateId === pb.id ? s.pickerChipTextActive : {}]}
                          numberOfLines={1}>
                          {pb.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Text style={[s.settingDesc, { marginBottom: 6 }]}>Music style (optional)</Text>
                <View style={s.pickerRow}>
                  {MUSIC_STYLE_OPTIONS.slice(0, 6).map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[s.pickerChip, newPathMusicStyle === opt.value ? s.pickerChipActive : {}]}
                      onPress={() => setNewPathMusicStyle(prev => prev === opt.value ? '' : opt.value)}
                    >
                      <Text style={[s.pickerChipText, newPathMusicStyle === opt.value ? s.pickerChipTextActive : {}]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[s.settingDesc, { marginTop: 8, marginBottom: 6 }]}>Price per month (USD, optional — used by funnel checkout)</Text>
                <TextInput
                  style={s.textField}
                  value={newPathPriceDollars}
                  onChangeText={setNewPathPriceDollars}
                  placeholder="e.g. 19.99"
                  placeholderTextColor="#4A5568"
                  keyboardType="decimal-pad"
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Pressable
                    style={[s.saveBtn, { flex: 1, backgroundColor: '#1E2A3A' }]}
                    onPress={() => { setShowAddPath(false); setNewPathLabel(''); setNewPathTemplateId(''); setNewPathMusicStyle(''); setNewPathPriceDollars(''); }}
                  >
                    <Text style={[s.saveBtnText, { color: '#8A95A3' }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[s.saveBtn, { flex: 2 }, (!newPathLabel.trim() || savingPath) ? { opacity: 0.5 } : {}]}
                    onPress={addSubscriptionPath}
                    disabled={!newPathLabel.trim() || savingPath}
                  >
                    <Text style={s.saveBtnText}>{savingPath ? 'Adding...' : 'Add Path'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={s.addPathBtn} onPress={() => setShowAddPath(true)}>
                <Text style={s.addPathBtnText}>+ Add path</Text>
              </Pressable>
            )}

            <Pressable
              style={[s.saveBtn, savingSettings && { opacity: 0.6 }]}
              onPress={saveSettings}
              disabled={savingSettings}
            >
              <Text style={s.saveBtnText}>{savingSettings ? 'Saving...' : 'Save Settings'}</Text>
            </Pressable>
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
    minWidth: 160,
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
    maxHeight: '85%',
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
  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  pathRowLabel: {
    flex: 1,
    fontFamily: FB,
    fontSize: 13,
    color: '#F0F4F8',
  },
  pathDeleteText: {
    fontFamily: FB,
    fontSize: 12,
    color: '#EF4444',
  },
  addPathBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7C3AED44',
    marginBottom: 8,
  },
  addPathBtnText: {
    fontFamily: FB,
    fontSize: 13,
    color: '#A78BFA',
  },
  addPathForm: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  pickerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1A2332',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2D3748',
  },
  pickerChipActive: {
    backgroundColor: '#7C3AED22',
    borderColor: '#7C3AED',
  },
  pickerChipText: {
    fontFamily: FB,
    fontSize: 12,
    color: '#8A95A3',
  },
  pickerChipTextActive: {
    color: '#A78BFA',
  },
});
