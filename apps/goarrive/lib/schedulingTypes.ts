/**
 * schedulingTypes.ts — Data model for GoArrive Scheduling Backbone
 *
 * Core concepts:
 *   - ZoomRoom: A schedulable Zoom host resource (one per Zoom account)
 *   - RecurringSlot: A member's owned recurring time rhythm (e.g., Tue 6 AM weekly)
 *   - SessionInstance: A concrete occurrence generated from a recurring slot
 *   - AllocationResult: The outcome of assigning a Zoom room to a session instance
 *
 * Architecture decisions:
 *   1. Capacity is account-aware (per-room collision prevention)
 *   2. Scheduling is occurrence-based (concrete instances, not just rules)
 *   3. Allocation is explicit (each instance knows its assigned room)
 *   4. Private meetings only (each instance gets a distinct meeting context)
 *   5. Future recording compatibility (meeting IDs preserved for lookup)
 *   6. Auditability (every allocation decision is logged)
 */

import { Timestamp } from 'firebase/firestore';

// ─── Zoom Room Resource ──────────────────────────────────────────────────────

export type ZoomRoomStatus = 'active' | 'inactive' | 'maintenance';

export interface ZoomRoom {
  id: string;                       // Firestore doc ID
  coachId: string;                  // Owner coach UID
  label: string;                    // Human-readable name, e.g. "Zoom Room A"
  zoomAccountEmail: string;         // Zoom account email
  zoomUserId?: string;              // Zoom user ID (populated after OAuth)
  status: ZoomRoomStatus;
  maxConcurrentMeetings: number;    // Usually 1 for basic Zoom accounts
  createdAt: Timestamp;
  updatedAt: Timestamp;
  notes?: string;                   // Admin notes
}

// ─── Recurring Slot ──────────────────────────────────────────────────────────

export type RecurrencePattern = 'weekly' | 'biweekly';

export type SlotStatus = 'active' | 'paused' | 'cancelled';

export interface RecurringSlot {
  id: string;                       // Firestore doc ID
  coachId: string;                  // Coach who owns this slot
  memberId: string;                 // Member who owns this time rhythm
  memberName: string;               // Denormalized for display
  dayOfWeek: number;                // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startTime: string;                // HH:mm in 24h format, e.g. "06:00"
  durationMinutes: number;          // Session length, e.g. 30 or 60
  timezone: string;                 // IANA timezone, e.g. "America/New_York"
  recurrencePattern: RecurrencePattern;
  status: SlotStatus;
  effectiveFrom: Timestamp;         // When this slot starts generating instances
  effectiveUntil?: Timestamp;       // Optional end date
  createdAt: Timestamp;
  updatedAt: Timestamp;
  notes?: string;
}

// ─── Session Instance ────────────────────────────────────────────────────────

export type InstanceStatus =
  | 'scheduled'       // Generated, awaiting allocation
  | 'allocated'       // Zoom room assigned
  | 'allocation_failed' // No room available
  | 'in_progress'     // Session started
  | 'completed'       // Session finished
  | 'missed'          // Member did not join
  | 'cancelled'       // Cancelled by coach or member
  | 'rescheduled';    // Moved to a different time

export interface SessionInstance {
  id: string;                       // Firestore doc ID
  coachId: string;
  memberId: string;
  memberName: string;               // Denormalized for display
  recurringSlotId: string;          // Parent recurring slot
  scheduledDate: string;            // YYYY-MM-DD
  scheduledStartTime: string;       // HH:mm in 24h format
  scheduledEndTime: string;         // HH:mm in 24h format
  durationMinutes: number;
  timezone: string;
  status: InstanceStatus;

  // Allocation fields
  zoomRoomId?: string;              // Assigned Zoom room doc ID
  zoomRoomLabel?: string;           // Denormalized room label
  zoomMeetingId?: string;           // Zoom meeting ID (for join URL)
  zoomJoinUrl?: string;             // Member join URL
  zoomStartUrl?: string;            // Host start URL
  zoomMeetingPassword?: string;     // Meeting password
  allocatedAt?: Timestamp;
  allocationAttempts?: number;      // How many times allocation was tried
  allocationFailReason?: string;    // Why allocation failed

  // Attendance fields (future — hooks only)
  joinedAt?: Timestamp;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  attendanceStatus?: 'joined' | 'started' | 'completed' | 'missed' | 'no_show';

  // Recording fields (future — hooks only)
  recordingAvailable?: boolean;
  recordingUrl?: string;
  recordingReviewedByCoach?: boolean;

  // Rescheduling
  rescheduledFrom?: string;         // Original date if rescheduled
  rescheduledTo?: string;           // New date if this was the original

  // Metadata
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Allocation Audit Log ────────────────────────────────────────────────────

export type AuditAction =
  | 'allocation_success'
  | 'allocation_failed'
  | 'allocation_retry'
  | 'room_conflict'
  | 'instance_created'
  | 'instance_cancelled'
  | 'instance_rescheduled'
  | 'slot_created'
  | 'slot_paused'
  | 'slot_cancelled'
  | 'room_added'
  | 'room_updated'
  | 'room_deactivated';

export interface SchedulingAuditEntry {
  id: string;
  coachId: string;
  action: AuditAction;
  sessionInstanceId?: string;
  recurringSlotId?: string;
  zoomRoomId?: string;
  memberId?: string;
  details: string;                  // Human-readable description of what happened
  metadata?: Record<string, any>;   // Additional structured data
  createdAt: Timestamp;
}

// ─── Zoom Provider Interface ─────────────────────────────────────────────────

export interface ZoomMeetingRequest {
  topic: string;
  startTime: string;                // ISO 8601 datetime
  duration: number;                 // minutes
  timezone: string;
  zoomUserId: string;               // Zoom user ID of the host account
}

export interface ZoomMeetingResponse {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
  password: string;
  hostEmail: string;
}

export interface ZoomProvider {
  createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse>;
  deleteMeeting(meetingId: string): Promise<void>;
  getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null>;
}

// ─── Helper: Day of week labels ──────────────────────────────────────────────

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Helper: Format time ─────────────────────────────────────────────────────

export function formatTime(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function addMinutesToTime(time24: string, minutes: number): string {
  const [h, m] = time24.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}
