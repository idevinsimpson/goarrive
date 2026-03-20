/**
 * MemberDetail — Member detail bottom sheet
 *
 * Shows member info, assigned workouts (via AssignedWorkoutsList),
 * edit and archive actions.
 *
 * Fixes applied (Week 1 hardening):
 *   - Replace hardcoded "No workouts assigned yet" stub with real AssignedWorkoutsList
 *   - Fix onArchive signature: pass full member object (not just id)
 *   - Match GoArrive design system (dark bg, gold accents, DM Sans / Space Grotesk)
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Icon } from './Icon';
import AssignedWorkoutsList from './AssignedWorkoutsList';
import { router } from 'expo-router';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface MemberDetailProps {
  member: any;
  onClose: () => void;
  onEdit: (member: any) => void;
  /** Receives the full member object so the caller can read name + isArchived */
  onArchive: (member: any) => void;
}

export default function MemberDetail({
  member,
  onClose,
  onEdit,
  onArchive,
}: MemberDetailProps) {
  const [currentMember, setCurrentMember] = useState(member);
  const [assignRefresh, setAssignRefresh] = useState(0);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [member.id]);

  const initials = currentMember.name
    ? currentMember.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w: string) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.name} numberOfLines={1}>
                {currentMember.name}
              </Text>
              {currentMember.isArchived && (
                <View style={styles.archivedBadge}>
                  <Text style={styles.archivedBadgeText}>Archived</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          {/* Scrollable body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Contact info */}
            <View style={styles.infoSection}>
              {currentMember.email ? (
                <View style={styles.infoRow}>
                  <Icon name="mail" size={16} color="#4A5568" />
                  <Text style={styles.infoText} numberOfLines={1}>
                    {currentMember.email}
                  </Text>
                </View>
              ) : null}
              {currentMember.phone ? (
                <View style={styles.infoRow}>
                  <Icon name="phone" size={16} color="#4A5568" />
                  <Text style={styles.infoText} numberOfLines={1}>
                    {currentMember.phone}
                  </Text>
                </View>
              ) : null}
              {currentMember.notes ? (
                <View style={styles.notesRow}>
                  <Icon name="document" size={16} color="#4A5568" />
                  <Text style={styles.notesText}>{currentMember.notes}</Text>
                </View>
              ) : null}
            </View>

            {/* Assigned workouts — real data via AssignedWorkoutsList */}
            <AssignedWorkoutsList
              memberId={currentMember.id}
              coachId={currentMember.coachId}
              refreshTrigger={assignRefresh}
              onUnassign={() => setAssignRefresh((n) => n + 1)}
            />

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Footer actions */}
          <View style={styles.footer}>
            {/* View Plan / Questionnaire */}
            <TouchableOpacity
              style={styles.planBtn}
              onPress={() => {
                onClose();
                router.push(`/(app)/member-plan/${currentMember.id}` as any);
              }}
            >
              <Icon name="document" size={18} color="#F5A623" />
              <Text style={styles.planBtnText}>View Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => onEdit(currentMember)}
            >
              <Icon name="edit" size={18} color="#0E1117" />
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.archiveBtn,
                currentMember.isArchived && styles.restoreBtn,
              ]}
              onPress={() => onArchive(currentMember)}
            >
              <Icon
                name={currentMember.isArchived ? 'refresh' : 'archive'}
                size={18}
                color={currentMember.isArchived ? '#86EFAC' : '#E05252'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1.5,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  archivedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,85,104,0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  archivedBadgeText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingTop: 4,
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FONT_BODY,
    flex: 1,
  },
  notesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
  },
  notesText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    flex: 1,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  planBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  planBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 8,
  },
  editBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  archiveBtn: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.3)',
  },
  restoreBtn: {
    backgroundColor: 'rgba(134,239,172,0.08)',
    borderColor: 'rgba(134,239,172,0.3)',
  },
});
