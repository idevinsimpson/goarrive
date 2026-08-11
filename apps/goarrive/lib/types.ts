/**
 * Shared types used across the GoArrive codebase.
 */

/** Represents a Firestore Timestamp or its serialized form */
export type FirestoreTimestamp = {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
};

export interface PlaybookFolderSubscriptionPath {
  id: string;
  label: string;
  templatePlaybookId: string;
  musicStyle?: string;
}

export interface PlaybookFolderEmailTemplate {
  subject: string;
  body: string;
}

/** playbook_folders Firestore document */
export interface PlaybookFolder {
  id: string;
  coachId: string;
  name: string;
  type: 'playbook_folder';
  parentId: string | null;
  templatePlaybookIds: string[];
  subscriptionPaths: PlaybookFolderSubscriptionPath[];
  syncEnabled: boolean;
  emailTemplate: PlaybookFolderEmailTemplate;
  linkedShareTokenIds: string[];
  isArchived: boolean;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

export type PlaybookFolderMemberStatus = 'active' | 'paused' | 'canceled';

/** playbook_folder_members Firestore document */
export interface PlaybookFolderMember {
  id: string;
  playbookFolderId: string;
  coachId: string;
  memberId: string | null;
  email: string;
  name: string;
  duplicatedPlaybookId: string;
  subscriptionPathId: string;
  scheduleDaysOfWeek: number[];
  scheduleTimeOfDay: string;
  stripeSubscriptionId: string | null;
  status: PlaybookFolderMemberStatus;
  pausedReason: string | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
