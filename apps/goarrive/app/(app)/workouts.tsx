import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { db } from '../../lib/firebase';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { AppHeader } from '../../components/AppHeader';
import ListSkeleton from '../../components/ListSkeleton';
import WorkoutForm from '../../components/WorkoutForm';
import WorkoutDetail from '../../components/WorkoutDetail';
import { Ionicons } from '@expo/vector-icons';

export default function WorkoutsScreen() {
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<any>(null);

  useEffect(() => {
    const q = query(collection(db, 'workouts'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const workoutList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setWorkouts(workoutList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = (id: string) => {
    Alert.alert(
      "Delete Workout",
      "Are you sure you want to delete this workout?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'workouts', id));
            } catch (error) {
              Alert.alert("Error", "Could not delete workout.");
            }
          } 
        }
      ]
    );
  };

  const renderWorkoutItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => setSelectedWorkout(item)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <TouchableOpacity onPress={() => handleDelete(item.id)}>
          <Ionicons name="trash-outline" size={20} color="#FF4D4D" />
        </TouchableOpacity>
      </View>
      <Text style={styles.cardSubtitle}>{item.blocks?.length || 0} blocks • {item.description || 'No description'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <AppHeader />
      
      <View style={styles.content}>
        <View style={styles.headerActions}>
          <Text style={styles.countText}>{workouts.length} Workouts</Text>
          <TouchableOpacity 
            style={styles.addButton} 
            onPress={() => setShowForm(true)}
          >
            <Ionicons name="add" size={20} color="#0E1117" />
            <Text style={styles.addButtonText}>New Workout</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ListSkeleton count={5} />
        ) : (
          <FlatList
            data={workouts}
            renderItem={renderWorkoutItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="barbell-outline" size={48} color="#444" />
                <Text style={styles.emptyText}>No workouts created yet.</Text>
              </View>
            }
          />
        )}
      </View>

      {showForm && (
        <WorkoutForm 
          visible={showForm} 
          onClose={() => setShowForm(false)} 
        />
      )}

      {selectedWorkout && (
        <WorkoutDetail 
          workout={selectedWorkout} 
          onClose={() => setSelectedWorkout(null)} 
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  countText: {
    color: '#888',
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#FFB347',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#0E1117',
    fontWeight: 'bold',
    marginLeft: 4,
  },
  list: {
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#1C2128',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#30363D',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#888',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
  },
  emptyText: {
    color: '#888',
    marginTop: 12,
    fontSize: 16,
  },
});
