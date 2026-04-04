/**
 * Shared mock movement data for tests.
 * Matches the MovementFilterable interface from useMovementFilters.
 */
import type { MovementFilterable } from '../../hooks/useMovementFilters';

export const mockMovements: MovementFilterable[] = [
  { id: '1', name: 'Bench Press', category: 'Upper Body', equipment: 'Barbell', muscleGroups: ['Chest'], coachId: 'c1', isGlobal: false },
  { id: '2', name: 'Barbell Squat', category: 'Lower Body', equipment: 'Barbell', muscleGroups: ['Quads'], coachId: 'c1', isGlobal: false },
  { id: '3', name: 'Plank', category: 'Core', equipment: 'Bodyweight', muscleGroups: ['Core'], coachId: '', isGlobal: true },
  { id: '4', name: 'Romanian Deadlift', category: 'Lower Body', equipment: 'Barbell', muscleGroups: ['Hamstrings'], coachId: 'c1', isGlobal: false },
  { id: '5', name: 'Push-Up', category: 'Upper Body', equipment: 'Bodyweight', muscleGroups: ['Chest'], coachId: '', isGlobal: true },
  { id: '6', name: 'Dumbbell Curl', category: 'Upper Body', equipment: 'Dumbbell', muscleGroups: ['Biceps'], coachId: 'c1', isGlobal: false },
  { id: '7', name: 'Pull Up', category: 'Upper Body', equipment: 'Bodyweight', muscleGroups: ['Back'], coachId: '', isGlobal: true },
];
