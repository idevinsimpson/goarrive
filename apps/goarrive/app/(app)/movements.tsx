import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { db } from '../../lib/firebase';
import { collection, query, onSnapshot, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { AppHeader } from '../../components/AppHeader';
import ListSkeleton from '../../components/ListSkeleton';
import MovementForm from '../../components/MovementForm';
import MovementDetail from '../../components/MovementDetail';
import { Ionicons } from '@expo/vector-icons';

export default function MovementsScreen() {
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<any>(null);

  useEffect(() => {
    const q = query(collection(db, 'movements'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const movementList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMovements(movementList);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleDelete = (id: string) => {
    Alert.alert(
      "Delete Movement",
      "Are you sure you want to delete this movement?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'movements', id));
            } catch (error) {
              Alert.alert("Error", "Could not delete movement.");
            }
          } 
        }
      ]
    );
  };

  const renderMovementItem = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => setSelectedMovement(item)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <TouchableOpacity onPress={() => handleDelete(item.id)}>
          <Ionicons name="trash-outline" size={20} color="#FF4D4D" />
        </TouchableOpacity>
      </View>
      <Text style={styles.cardSubtitle}>{item.category || 'Uncategorized'} • {item.equipment || 'No equipment'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <AppHeader />
      
      <View style={styles.content}>
        <View style={styles.headerActions}>
          <Text style={styles.countText}>{movements.length} Movements</Text>
          <TouchableOpacity 
            style={styles.addButton} 
            onPress={() => setShowForm(true)}
          >
            <Ionicons name="add" size={20} color="#0E1117" />
            <Text style={styles.addButtonText}>New Movement</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ListSkeleton count={8} />
        ) : (
          <FlatList
            data={movements}
            renderItem={renderMovementItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="fitness-outline" size={48} color="#444" />
                <Text style={styles.emptyText}>No movements added yet.</Text>
              </View>
            }
          />
        )}
      </View>

      {showForm && (
        <MovementForm 
          visible={showForm} 
          onClose={() => setShowForm(false)} 
        />
      )}

      {selectedMovement && (
<MovementDetail
          visible={!!selectedMovement}
          movement={selectedMovement} 
          onClose={() => setSelectedMovement(null)} 
          onEdit={() => {}}
          onArchive={() => {}}
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
