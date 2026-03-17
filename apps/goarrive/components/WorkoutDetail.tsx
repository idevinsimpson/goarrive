import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

interface WorkoutDetailProps {
  workout: any;
  onClose: () => void;
}

export default function WorkoutDetail({ workout, onClose }: WorkoutDetailProps) {
  const [currentWorkout, setCurrentWorkout] = useState(workout);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'workouts', workout.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentWorkout({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [workout.id]);

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{currentWorkout.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.details}>
            <Text style={styles.label}>Description</Text>
            <Text style={styles.descriptionText}>{currentWorkout.description || 'No description provided.'}</Text>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Workout Blocks ({currentWorkout.blocks?.length || 0})</Text>
              <TouchableOpacity style={styles.editButton}>
                <Ionicons name="create-outline" size={20} color="#FFB347" />
                <Text style={styles.editButtonText}>Edit Blocks</Text>
              </TouchableOpacity>
            </View>

            {currentWorkout.blocks && currentWorkout.blocks.length > 0 ? (
              currentWorkout.blocks.map((block: any, index: number) => (
                <View key={index} style={styles.blockCard}>
                  <Text style={styles.blockTitle}>{block.type || 'Block'} {index + 1}</Text>
                  <Text style={styles.blockDetail}>{block.movements?.length || 0} movements</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No blocks added to this workout yet.</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.actionButton} onPress={() => Alert.alert("Coming Soon", "Assignment feature coming soon.")}>
              <Ionicons name="person-add-outline" size={20} color="#0E1117" />
              <Text style={styles.actionButtonText}>Assign to Member</Text>
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
    height: '90%',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  details: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  descriptionText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editButtonText: {
    color: '#FFB347',
    marginLeft: 4,
    fontWeight: '600',
  },
  blockCard: {
    backgroundColor: '#0E1117',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  blockDetail: {
    fontSize: 14,
    color: '#888',
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
    marginTop: 20,
  },
  actionButton: {
    backgroundColor: '#FFB347',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionButtonText: {
    color: '#0E1117',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
});
