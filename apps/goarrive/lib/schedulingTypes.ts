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
 *
 * Prompt 2 extensions:
 *   7. Guidance-aware hosting: sessions carry hostingMode + coachExpectedLive
 *   8. Shared Guidance and Self-Reliant use shared hosted infrastructure
 *   9. Only coach-led sessions land on the coach's live calendar
 *  10. Phase transition and CTS awareness per slot/instance
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

// ─── Guidance Phase & Hosting ───────────────────────────────────────────────

/**
 * GuidancePhase maps to the three plan phases:
 *   - coach_guided   = Phase 1 (Fully Guided)  → coach-led, uses coach's personal Zoom
 *   - shared_guidance = Phase 2 (Blended)       → hosted session infrastructure + coach live window
 *   - self_guided     = Phase 3 (Self-Reliant)  → hosted session infrastructure only
 */
export type GuidancePhase = 'coach_guided' | 'shared_guidance' | 'self_guided';

/**
 * RoomSource determines which Zoom account hosts the meeting:
 *   - coach_personal = Coach's own Zoom account (1:1 with the member)
 *   - shared_pool    = Shared hosted session infrastructure (internal)
 */
export type RoomSource = 'coach_personal' | 'shared_pool';

/**
 * HostingMode — coach-facing concept for how a session is hosted.
 *   - coach_led: Coach runs the session live on their personal Zoom
 *   - hosted:    Session runs on shared infrastructure; coach may or may not join
 *
 * This is the product-facing term. RoomSource is the internal allocation term.
 */
export type HostingMode = 'coach_led' | 'hosted';

export type PlanSessionType = 'Strength' | 'Cardio + Mobility' | 'Mix';

/** Session type used in scheduling UI (lowercase, granular) */
export type SchedulingSessionType = 'strength' | 'cardio' | 'flexibility' | 'hiit' | 'recovery' | 'check_in';

export const GUIDANCE_PHASE_LABELS: Record<GuidancePhase, string> = {
  coach_guided: 'Coach Guided',
  shared_guidance: 'Shared Guidance',
  self_guided: 'Self Guided',
};

/** Coach-facing hosting mode labels (no infrastructure language) */
export const HOSTING_MODE_LABELS: Record<HostingMode, string> = {
  coach_led: 'Coach-led',
  hosted: 'Hosted',
};

export const ROOM_SOURCE_LABELS: Record<RoomSource, string> = {
  coach_personal: 'Your Zoom',
  shared_pool: 'Shared Room',
};

export const SESSION_TYPE_LABELS: Record<SchedulingSessionType, string> = {
  strength: 'Strength',
  cardio: 'Cardio',
  flexibility: 'Flexibility',
  hiit: 'HIIT',
  recovery: 'Recovery',
  check_in: 'Check-in',
};

/**
 * Determines the default room source for a guidance phase.
 * Prompt 2 correction: shared_guidance now defaults to shared_pool (hosted infrastructure).
 */
export function defaultRoomSource(phase: GuidancePhase): RoomSource {
  if (phase === 'coach_guided') return 'coach_personal';
  return 'shared_pool'; // shared_guidance + self_guided → hosted infrastructure
}

/**
 * Determines the hosting mode for a guidance phase.
 * coach_guided → coach_led; shared_guidance + self_guided → hosted
 */
export function defaultHostingMode(phase: GuidancePhase): HostingMode {
  if (phase === 'coach_guided') return 'coach_led';
  return 'hosted';
}

/**
 * Determines whether the coach is expected live for a session based on phase.
 * coach_guided → always true
 * shared_guidance → true (coach has a live window, duration set by slider)
 * self_guided → false
 */
export function defaultCoachExpectedLive(phase: GuidancePhase): boolean {
  if (phase === 'coach_guided') return true;
  if (phase === 'shared_guidance') return true; // coach has live segment
  return false; // self_guided
}

// ─── Recurring Slot ──────────────────────────────────────────────────────────

export type RecurrencePattern = 'weekly' | 'biweekly' | 'monthly';

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
  weekOfMonth?: 1 | 2 | 3 | 4;       // Only for monthly: 1st, 2nd, 3rd, or 4th occurrence of the day
  status: SlotStatus;
  effectiveFrom: Timestamp;         // When this slot starts generating instances
  effectiveUntil?: Timestamp;       // Optional end date

  // Phase-aware scheduling fields
  sessionType?: PlanSessionType;  // What kind of session (Strength, Cardio, Mix)
  guidancePhase?: GuidancePhase;      // Which plan phase this slot belongs to
  roomSource?: RoomSource;            // Where the Zoom meeting comes from (internal)
  coachJoining?: boolean;             // For shared_guidance: is the coach joining this session?

  // Prompt 2: Guidance-aware hosting fields
  hostingMode?: HostingMode;          // coach_led or hosted (product-facing)
  coachExpectedLive?: boolean;        // Should this session appear on coach's live calendar?
  personalZoomRequired?: boolean;     // Does this session need the coach's personal Zoom?

  // Prompt 2: Live support window (for shared_guidance)
  liveCoachingStartMin?: number;      // Minutes from session start when coach joins
  liveCoachingEndMin?: number;        // Minutes from session start when coach leaves
  liveCoachingDuration?: number;      // Total live coaching minutes (calendar block)

  // Prompt 2: Phase transition awareness
  transitionDate?: string;            // YYYY-MM-DD when this slot transitions to next phase
  transitionToPhase?: GuidancePhase;  // What phase it transitions to

  // Prompt 2: Commit to Save
  commitToSaveEnabled?: boolean;      // Whether CTS applies to this session stream

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
  | 'rescheduled'     // Moved to a different time
  | 'skipped'         // Skipped by coach or approved skip request
  | 'skip_requested'; // Member requested skip, awaiting coach approval

export type SkipCategory = 'Holiday' | 'Vacation' | 'Illness' | 'Coach Unavailable' | 'Other';

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

  // Phase-aware scheduling fields
  sessionType?: PlanSessionType;  // Inherited from slot
  guidancePhase?: GuidancePhase;      // Inherited from slot
  roomSource?: RoomSource;            // Inherited from slot (can be overridden per instance)
  coachJoining?: boolean;             // For shared_guidance: coach toggled on/off for this instance

  // Prompt 2: Guidance-aware hosting fields
  hostingMode?: HostingMode;          // coach_led or hosted
  coachExpectedLive?: boolean;        // Should this instance appear on coach's live calendar?
  personalZoomRequired?: boolean;     // Does this instance need the coach's personal Zoom?

  // Prompt 2: Live support window (for shared_guidance instances)
  liveCoachingStartMin?: number;      // Minutes from session start when coach joins
  liveCoachingEndMin?: number;        // Minutes from session start when coach leaves
  liveCoachingDuration?: number;      // Total live coaching minutes

  // Prompt 2: Commit to Save
  commitToSaveEnabled?: boolean;      // Whether CTS applies to this session

  // Allocation fields
  zoomRoomId?: string;              // Assigned Zoom room doc ID
  zoomRoomLabel?: string;           // Denormalized room label
  zoomMeetingId?: string;           // Zoom meeting ID (for join URL)
  zoomMeetingUuid?: string;         // Zoom meeting UUID (for API lookups)
  zoomJoinUrl?: string;             // Member join URL
  zoomStartUrl?: string;            // Host start URL
  zoomMeetingPassword?: string;     // Meeting password
  zoomProviderMode?: 'mock' | 'live'; // Which provider created this meeting
  allocatedAt?: Timestamp;
  allocationAttempts?: number;      // How many times allocation was tried
  allocationFailReason?: string;    // Why allocation failed

  // Attendance fields (populated by Zoom webhook)
  actualStartTime?: string;         // ISO 8601 from meeting.started webhook
  actualEndTime?: string;           // ISO 8601 from meeting.ended webhook
  attendance?: Record<string, {     // Keyed by participant ID or name
    name: string;
    email?: string;
    joinTime?: string;
    leaveTime?: string;
  }>;
  joinedAt?: Timestamp;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  attendanceStatus?: 'joined' | 'started' | 'completed' | 'missed' | 'no_show';

  // Recording fields (populated by Zoom webhook)
  recordings?: SessionRecordingMeta[];
  recordingCompletedAt?: Timestamp;
  recordingAvailable?: boolean;
  recordingUrl?: string;
  recordingReviewedByCoach?: boolean;

  // Skip fields
  skipReason?: string;              // Freeform reason for skip
  skipCategory?: SkipCategory;      // Predefined category for reporting
  skipRequestedBy?: string;         // UID of member who requested skip
  skipRequestedAt?: Timestamp;      // When skip was requested
  skipApprovedBy?: string;          // UID of coach who approved/denied

  // Zoom recording URL (set by recording.completed webhook)
  zoomRecordingUrl?: string;        // Direct URL to Zoom cloud recording
  zoomRecordingMeetingId?: string;  // Zoom meeting ID for recording refresh proxy

  // Transcription fields (populated by recording.completed webhook)
  transcriptionUrl?: string;        // URL to Zoom transcription file
  transcriptionStatus?: 'available' | 'processing' | 'none';

  // Session notes
  notes?: string;                   // Coach notes for this instance

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
  uuid?: string;                    // Zoom meeting UUID (live provider only)
  joinUrl: string;
  startUrl: string;
  password: string;
  hostEmail: string;
}

export interface ZoomProvider {
  mode: 'mock' | 'live';            // Which provider mode is active
  createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse>;
  deleteMeeting(meetingId: string): Promise<void>;
  getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null>;
}

// ─── Session Recording Metadata ─────────────────────────────────────────────

export interface SessionRecordingMeta {
  fileType: string;                 // e.g. 'MP4', 'M4A', 'TRANSCRIPT'
  fileSize?: number;                // bytes
  downloadUrl?: string;             // Zoom download URL (time-limited)
  playUrl?: string;                 // Zoom play URL
  recordingStart?: string;          // ISO 8601
  recordingEnd?: string;            // ISO 8601
  status?: string;                  // e.g. 'completed'
}

// ─── Session Event (Durable Ledger) ─────────────────────────────────────────

export interface SessionEvent {
  id?: string;                      // Firestore doc ID
  occurrenceId: string;             // session_instances doc ID
  eventType: string;                // e.g. 'meeting_created', 'meeting_started', 'participant_joined'
  source: 'system' | 'zoom_webhook' | 'coach_action' | 'member_action';
  providerMode: 'mock' | 'live';
  zoomMeetingId?: string;
  zoomMeetingUuid?: string;
  timestamp: any;                   // FieldValue.serverTimestamp() or Timestamp
  idempotencyKey?: string;          // Prevents duplicate event processing
  payload?: Record<string, any>;    // Event-specific data
}

// ─── Coach Zoom Connection (for account/settings) ───────────────────────────

export interface CoachZoomConnection {
  coachId: string;
  zoomEmail?: string;               // Coach's personal Zoom email
  zoomUserId?: string;              // Zoom user ID
  connected: boolean;               // Whether the connection is active
  connectedAt?: Timestamp;
  lastVerifiedAt?: Timestamp;
  status: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
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

// ─── Helper: Format date for display ─────────────────────────────────────────

export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${d}`;
}

// ─── Prompt 4: Admin Operations & Communications Types ──────────────────────

// ─── System Health (returned by getSystemHealth CF) ─────────────────────────

export interface ProviderHealthStatus {
  mode: 'mock' | 'live';
  name: string;
}

export interface ZoomHealthStatus extends ProviderHealthStatus {
  credentials: {
    accountId: boolean;
    clientId: boolean;
    clientSecret: boolean;
    webhookSecret: boolean;
  };
  apiReachable: boolean | null;
}

export interface SystemHealth {
  zoom: ZoomHealthStatus;
  notifications: {
    email: ProviderHealthStatus;
    sms: ProviderHealthStatus;
    push: ProviderHealthStatus;
  };
  deadLetterCount: number;
  reminderStats: {
    scheduled: number;
    sent: number;
    failed: number;
    skipped: number;
    canceled: number;
    total: number;
  };
  notificationStats: {
    pending: number;
    sent: number;
    failed: number;
    total: number;
  };
  timestamp: string;
}

// ─── Dead Letter ────────────────────────────────────────────────────────────

export type DeadLetterType =
  | 'notification_delivery_failed'
  | 'reminder_processing_failed'
  | 'allocation_failed'
  | 'webhook_processing_failed'
  | 'recording_ingestion_failed';

export interface DeadLetterItem {
  id: string;
  type: DeadLetterType;
  sourceCollection?: string;
  sourceId?: string;
  error: string;
  payload?: Record<string, any>;
  createdAt: Timestamp;
  resolved: boolean;
  resolvedAt?: Timestamp;
  resolvedBy?: string;
  retryCount?: number;
  lastRetryAt?: Timestamp;
  lastRetryError?: string;
}

// ─── Reminder Job ───────────────────────────────────────────────────────────

export type ReminderType =
  | 'member_24h'
  | 'member_1h'
  | 'coach_24h'
  | 'coach_1h'
  | 'missed_session_followup'
  | 'recording_ready';

export type ReminderStatus =
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'canceled'
  | 'skipped';

export interface ReminderJob {
  id: string;
  reminderType: ReminderType;
  sessionInstanceId: string;
  recipientUid: string;
  recipientRole: 'member' | 'coach';
  coachId: string;
  memberId: string;
  scheduledFor: Timestamp;
  status: ReminderStatus;
  channels: ('email' | 'sms' | 'push')[];
  notificationIds: string[];
  createdAt: Timestamp;
  processedAt?: Timestamp;
  error?: string;
  sessionDate?: string;
  sessionTime?: string;
  sessionType?: string;
  memberName?: string;
  coachName?: string;
  guidancePhase?: string;
  joinUrl?: string;
}

// ─── Notification Log ───────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'sms' | 'push';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'canceled';
export type MessageType =
  | 'session_reminder'
  | 'session_starting_soon'
  | 'missed_session_followup'
  | 'recording_ready'
  | 'coach_session_reminder'
  | 'admin_alert';

export interface NotificationLogEntry {
  id: string;
  messageType: MessageType;
  channel: NotificationChannel;
  recipient: {
    uid: string;
    email?: string;
    phone?: string;
    displayName?: string;
    role: 'member' | 'coach' | 'admin';
  };
  subject?: string;
  body: string;
  sessionInstanceId?: string;
  coachId?: string;
  memberId?: string;
  status: DeliveryStatus;
  providerMode: 'mock' | 'live';
  providerName: string;
  providerMessageId?: string;
  providerError?: string;
  createdAt: Timestamp;
  sentAt?: Timestamp;
  failedAt?: Timestamp;
  retryCount: number;
}

// ─── Recording Status (derived from session instance) ───────────────────────

export type RecordingStatus =
  | 'not_expected'    // Self-guided or no recording configured
  | 'pending'         // Session completed, recording expected but not yet received
  | 'processing'      // Recording webhook received, processing
  | 'ready'           // Recording available
  | 'failed'          // Recording ingestion failed
  | 'missing';        // Session ended but no recording arrived after expected window

export function deriveRecordingStatus(instance: SessionInstance): RecordingStatus {
  if (!instance.zoomMeetingId) return 'not_expected';
  if (instance.recordingAvailable && instance.recordings && instance.recordings.length > 0) return 'ready';
  if (instance.recordingCompletedAt) return 'processing';
  if (instance.status === 'completed' || instance.actualEndTime) {
    // Session ended — check if enough time has passed for recording
    return 'pending';
  }
  if (instance.status === 'missed' || instance.status === 'cancelled') return 'not_expected';
  return 'not_expected';
}

// ─── Attendance Summary (derived from session events) ───────────────────────

export type AttendanceOutcome =
  | 'completed'       // Meeting started and ended normally
  | 'started'         // Meeting started but no end event yet
  | 'joined'          // Participant joined but meeting status unclear
  | 'missed'          // No join events received
  | 'canceled'        // Session was canceled
  | 'unknown';        // Insufficient data

export function deriveAttendanceOutcome(instance: SessionInstance): AttendanceOutcome {
  if (instance.status === 'cancelled') return 'canceled';
  if (instance.attendanceStatus === 'completed' || instance.actualEndTime) return 'completed';
  if (instance.attendanceStatus === 'started' || instance.actualStartTime) return 'started';
  if (instance.attendanceStatus === 'joined' || instance.joinedAt) return 'joined';
  if (instance.status === 'missed') return 'missed';
  return 'unknown';
}

// ─── Session Event Types (for event log) ────────────────────────────────────

export const SESSION_EVENT_TYPE_LABELS: Record<string, string> = {
  meeting_created: 'Meeting Created',
  meeting_deleted: 'Meeting Deleted',
  meeting_creation_failed: 'Meeting Creation Failed',
  meeting_started: 'Meeting Started',
  meeting_ended: 'Meeting Ended',
  participant_joined: 'Participant Joined',
  participant_left: 'Participant Left',
  recording_completed: 'Recording Completed',
  session_cancelled: 'Session Cancelled',
  session_rescheduled: 'Session Rescheduled',
};

export const SESSION_EVENT_SOURCE_LABELS: Record<string, string> = {
  system: 'System',
  zoom_webhook: 'Zoom Webhook',
  coach_action: 'Coach Action',
  member_action: 'Member Action',
};
