/**
 * Shared mock movement data for tests.
 * Matches the MovementFilterable interface from useMovementFilters.
 */
import type { MovementFilterable } from '../../hooks/useMovementFilters';

export const mockMovements: MovementFilterable[] = [
  { id: '1', name: 'Bench Press', category: 'Upper Body', equipment: 'Barbell', muscleGroups: ['Chest'], difficulty: 'Intermediate', coachId: 'c1', isGlobal: false, createdAt: { seconds: 1000, nanoseconds: 0 }, updatedAt: { seconds: 1500, nanoseconds: 0 } },
  { id: '2', name: 'Barbell Squat', category: 'Lower Body', equipment: 'Barbell', muscleGroups: ['Quads'], difficulty: 'Intermediate', coachId: 'c1', isGlobal: false, createdAt: { seconds: 2000, nanoseconds: 0 } },
  { id: '3', name: 'Plank', category: 'Core', equipment: 'Bodyweight', muscleGroups: ['Core'], difficulty: 'Beginner', coachId: '', isGlobal: true, createdAt: { seconds: 3000, nanoseconds: 0 } },
  { id: '4', name: 'Romanian Deadlift', category: 'Lower Body', equipment: 'Barbell', muscleGroups: ['Hamstrings'], difficulty: 'Advanced', coachId: 'c1', isGlobal: false, createdAt: { seconds: 4000, nanoseconds: 0 } },
  { id: '5', name: 'Push-Up', category: 'Upper Body', equipment: 'Bodyweight', muscleGroups: ['Chest'], difficulty: 'Beginner', coachId: '', isGlobal: true, createdAt: { seconds: 5000, nanoseconds: 0 }, updatedAt: { seconds: 6000, nanoseconds: 0 } },
  { id: '6', name: 'Dumbbell Curl', category: 'Upper Body', equipment: 'Dumbbell', muscleGroups: ['Biceps'], difficulty: 'Beginner', coachId: 'c1', isGlobal: false, createdAt: { seconds: 6000, nanoseconds: 0 } },
  { id: '7', name: 'Pull Up', category: 'Upper Body', equipment: 'Bodyweight', muscleGroups: ['Back'], difficulty: 'Intermediate', coachId: '', isGlobal: true, createdAt: { seconds: 7000, nanoseconds: 0 } },
];
