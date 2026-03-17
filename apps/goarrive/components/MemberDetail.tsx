import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

interface MemberDetailProps {
  member: any;
  onClose: () => void;
  onEdit: (member: any) => void;
  onArchive: (id: string) => void;
}

export default function MemberDetail({ member, onClose, onEdit, onArchive }: MemberDetailProps) {
  const [currentMember, setCurrentMember] = useState(member);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'members', member.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentMember({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [member.id]);

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{currentMember.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.details}>
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={20} color="#888" />
              <Text style={styles.infoText}>{currentMember.email}</Text>
            </View>
            {currentMember.phone && (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={20} color="#888" />
                <Text style={styles.infoText}>{currentMember.phone}</Text>
              </View>
            )}

            <View style={styles.divider} />

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Assigned Workouts</Text>
            </View>
            
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No workouts assigned yet.</Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.editButton} onPress={() => onEdit(currentMember)}>
              <Ionicons name="create-outline" size={20} color="#0E1117" />
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.archiveButton} onPress={() => onArchive(currentMember.id)}>
              <Ionicons name="archive-outline" size={20} color="#FF4D4D" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1C2128',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '80%',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  details: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#30363D',
    marginVertical: 20,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyState: {
    padding: 30,
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#30363D',
  },
  emptyText: {
    color: '#888',
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  editButton: {
    backgroundColor: '#FFB347',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    flex: 1,
    marginRight: 12,
  },
  editButtonText: {
    color: '#0E1117',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  archiveButton: {
    backgroundColor: '#1C2128',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF4D4D',
  },
});
