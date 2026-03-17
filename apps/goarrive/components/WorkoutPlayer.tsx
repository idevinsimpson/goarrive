import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Animated, Platform } from 'react-native';
import { Icon } from './Icon';
import { playBeep } from '../lib/audioBeep';
import { hapticLight, hapticMedium, hapticHeavy, hapticSuccess } from '../lib/haptics';
import { useWakeLock } from '../lib/useWakeLock';

interface WorkoutPlayerProps {
  visible: boolean;
  workout: any;
  onClose: () => void;
  onComplete: () => void;
}

export default function WorkoutPlayer({ visible, workout, onClose, onComplete }: WorkoutPlayerProps) {
  const [active, setActive] = useState(false);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [currentMovementIndex, setCurrentMovementIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isResting, setIsResting] = useState(false);
  
  useWakeLock(active);

  const blocks = workout?.blocks || [];
  const currentBlock = blocks[currentBlockIndex];
  const currentMovement = currentBlock?.movements?.[currentMovementIndex];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (active && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 4 && prev > 1) {
            playBeep(440, 0.05);
            hapticLight();
          } else if (prev === 1) {
            playBeep(880, 0.1);
            hapticMedium();
          }
          return prev - 1;
        });
      }, 1000);
    } else if (active && timeLeft === 0) {
      handleNext();
    }
    return () => clearInterval(interval);
  }, [active, timeLeft]);

  const handleStart = () => {
    setActive(true);
    if (timeLeft === 0) {
      const initialTime = currentMovement?.duration || 30;
      setTimeLeft(initialTime);
      hapticHeavy();
    }
  };

  const handlePause = () => setActive(false);

  const handleNext = () => {
    // Logic to move to next movement or block
    const nextMovementIndex = currentMovementIndex + 1;
    if (nextMovementIndex < currentBlock?.movements?.length) {
      setCurrentMovementIndex(nextMovementIndex);
      setTimeLeft(currentBlock.movements[nextMovementIndex].duration || 30);
    } else {
      const nextBlockIndex = currentBlockIndex + 1;
      if (nextBlockIndex < blocks.length) {
        setCurrentBlockIndex(nextBlockIndex);
        setCurrentMovementIndex(0);
        setTimeLeft(blocks[nextBlockIndex].movements[0].duration || 30);
      } else {
        setActive(false);
        hapticSuccess();
        onComplete();
      }
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={32} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.workoutName}>{workout.name}</Text>
          <View style={{ width: 32 }} />
        </View>

        <View style={styles.mainContent}>
          <Text style={styles.blockInfo}>Block {currentBlockIndex + 1} of {blocks.length}</Text>
          <Text style={styles.movementName}>{currentMovement?.name || 'Get Ready'}</Text>
          
          <View style={styles.timerContainer}>
            <Text style={styles.timerText}>{timeLeft}</Text>
            <Text style={styles.timerLabel}>seconds remaining</Text>
          </View>
        </View>

        <View style={styles.controls}>
          {active ? (
            <TouchableOpacity style={styles.pauseButton} onPress={handlePause}>
              <Icon name="pause" size={48} color="#0E1117" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.startButton} onPress={handleStart}>
              <Icon name="play" size={48} color="#0E1117" />
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Icon name="skip-forward" size={32} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
    padding: 20,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 40,
  },
  workoutName: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
  mainContent: {
    alignItems: 'center',
  },
  blockInfo: {
    color: '#FFB347',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  movementName: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
  },
  timerContainer: {
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 8,
    borderColor: '#FFB347',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 80,
    fontWeight: 'bold',
  },
  timerLabel: {
    color: '#888',
    fontSize: 14,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 60,
  },
  startButton: {
    backgroundColor: '#FFB347',
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseButton: {
    backgroundColor: '#FFFFFF',
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButton: {
    position: 'absolute',
    right: 20,
  },
});
