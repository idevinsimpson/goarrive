/**
 * Shared types used across the GoArrive codebase.
 */

/** Represents a Firestore Timestamp or its serialized form */
export type FirestoreTimestamp = {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
};
