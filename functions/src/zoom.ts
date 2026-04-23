/**
 * GoArrive — Zoom Provider Module
 *
 * Implements the provider-factory pattern for Zoom meeting management:
 *   - MockZoomProvider: generates realistic-looking mock meeting data (safe testing)
 *   - RealZoomProvider: uses Zoom S2S OAuth to create/delete/get real meetings
 *   - getZoomProvider(): factory that returns the correct provider based on config
 *
 * Required Firebase Functions Config (for live mode):
 *   zoom.account_id   — Zoom S2S OAuth Account ID
 *   zoom.client_id    — Zoom S2S OAuth Client ID
 *   zoom.client_secret — Zoom S2S OAuth Client Secret
 *   zoom.webhook_secret — Zoom webhook secret token (for signature verification)
 *
 * If any credential is missing, the factory falls back to MockZoomProvider.
 */

import * as crypto from 'crypto';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface ZoomMeetingRequest {
  topic: string;
  startTime: string;       // ISO 8601 datetime
  duration: number;        // minutes
  timezone: string;
  hostEmail: string;       // Zoom user email to host the meeting
}

export interface ZoomMeetingResponse {
  meetingId: string;       // Zoom meeting ID (numeric string for real, "mock-..." for mock)
  joinUrl: string;
  startUrl: string;
  password: string;
  hostEmail: string;
  uuid?: string;           // Zoom meeting UUID (real only)
}

export interface ZoomProvider {
  readonly mode: 'mock' | 'live';
  createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse>;
  deleteMeeting(meetingId: string): Promise<void>;
  getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null>;
  updateMeeting(meetingId: string, updates: Partial<ZoomMeetingRequest>): Promise<void>;
}

// ─── S2S OAuth Token Management ─────────────────────────────────────────────

interface S2STokenCache {
  accessToken: string;
  expiresAt: number;       // Unix ms
}

let tokenCache: S2STokenCache | null = null;

/**
 * Get a valid S2S OAuth access token, using cache when possible.
 * Token TTL is 1 hour; we refresh 5 minutes early to avoid edge-case expiry.
 */
async function getS2SAccessToken(
  accountId: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: `grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Zoom S2S OAuth token request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  console.log(`[Zoom S2S] Token acquired, expires in ${data.expires_in}s, scopes: ${data.scope}`);
  return tokenCache.accessToken;
}

// ─── RealZoomProvider ───────────────────────────────────────────────────────

export class RealZoomProvider implements ZoomProvider {
  readonly mode = 'live' as const;

  constructor(
    private accountId: string,
    private clientId: string,
    private clientSecret: string
  ) {}

  private async getToken(): Promise<string> {
    return getS2SAccessToken(this.accountId, this.clientId, this.clientSecret);
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const token = await this.getToken();
    const url = `https://api.zoom.us/v2${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return response;
  }

  async createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse> {
    const response = await this.apiRequest('POST', `/users/${encodeURIComponent(request.hostEmail)}/meetings`, {
      topic: request.topic,
      type: 2, // Scheduled meeting
      start_time: request.startTime,
      duration: request.duration,
      timezone: request.timezone,
      settings: {
        join_before_host: true,
        waiting_room: false,
        auto_recording: 'cloud',
        mute_upon_entry: true,
        approval_type: 0, // Automatically approve
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zoom create meeting failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      id: number;
      uuid: string;
      join_url: string;
      start_url: string;
      password: string;
      host_email: string;
    };

    console.log(`[Zoom Real] Meeting created: ${data.id} for ${request.hostEmail}`);

    return {
      meetingId: String(data.id),
      uuid: data.uuid,
      joinUrl: data.join_url,
      startUrl: data.start_url,
      password: data.password,
      hostEmail: data.host_email,
    };
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    const response = await this.apiRequest('DELETE', `/meetings/${meetingId}`);

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      throw new Error(`Zoom delete meeting failed (${response.status}): ${errorText}`);
    }

    console.log(`[Zoom Real] Meeting deleted: ${meetingId}`);
  }

  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null> {
    const response = await this.apiRequest('GET', `/meetings/${meetingId}`);

    if (response.status === 404) return null;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zoom get meeting failed (${response.status}): ${errorText}`);
    }

    const data = await response.json() as {
      id: number;
      uuid: string;
      join_url: string;
      start_url: string;
      password: string;
      host_email: string;
    };

    return {
      meetingId: String(data.id),
      uuid: data.uuid,
      joinUrl: data.join_url,
      startUrl: data.start_url,
      password: data.password,
      hostEmail: data.host_email,
    };
  }

  async updateMeeting(meetingId: string, updates: Partial<ZoomMeetingRequest>): Promise<void> {
    const body: Record<string, unknown> = {};
    if (updates.topic) body.topic = updates.topic;
    if (updates.startTime) body.start_time = updates.startTime;
    if (updates.duration) body.duration = updates.duration;
    if (updates.timezone) body.timezone = updates.timezone;

    const response = await this.apiRequest('PATCH', `/meetings/${meetingId}`, body);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zoom update meeting failed (${response.status}): ${errorText}`);
    }

    console.log(`[Zoom Real] Meeting updated: ${meetingId}`);
  }
}

// ─── MockZoomProvider ───────────────────────────────────────────────────────

let mockCounter = 9000;

export class MockZoomProvider implements ZoomProvider {
  readonly mode = 'mock' as const;

  async createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse> {
    const meetingId = `mock-${Date.now()}-${++mockCounter}`;
    const password = Math.random().toString(36).substring(2, 8);

    console.log(`[Zoom Mock] Meeting created: ${meetingId} for ${request.hostEmail}`);

    return {
      meetingId,
      joinUrl: `https://zoom.us/j/${meetingId}?pwd=${password}`,
      startUrl: `https://zoom.us/s/${meetingId}?zak=mock_host_token`,
      password,
      hostEmail: request.hostEmail,
      uuid: `mock-uuid-${meetingId}`,
    };
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    console.log(`[Zoom Mock] Meeting deleted: ${meetingId}`);
  }

  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null> {
    if (!meetingId.startsWith('mock-')) return null;

    return {
      meetingId,
      joinUrl: `https://zoom.us/j/${meetingId}`,
      startUrl: `https://zoom.us/s/${meetingId}`,
      password: 'mock123',
      hostEmail: 'mock@goarrive.fit',
      uuid: `mock-uuid-${meetingId}`,
    };
  }

  async updateMeeting(meetingId: string, _updates: Partial<ZoomMeetingRequest>): Promise<void> {
    console.log(`[Zoom Mock] Meeting updated: ${meetingId}`);
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

interface ZoomConfig {
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}

let cachedProvider: ZoomProvider | null = null;
let cachedConfigHash: string | null = null;

/**
 * Get the Zoom provider based on available configuration.
 * Returns RealZoomProvider if all S2S credentials are present, MockZoomProvider otherwise.
 *
 * Config is read from Firebase Functions config: functions.config().zoom
 * Or from environment variables: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 */
export function getZoomProvider(config?: ZoomConfig): ZoomProvider {
  // Resolve config from params, env vars, or Firebase Functions config
  const resolved: ZoomConfig = {
    accountId: config?.accountId || process.env.ZOOM_ACCOUNT_ID || '',
    clientId: config?.clientId || process.env.ZOOM_CLIENT_ID || '',
    clientSecret: config?.clientSecret || process.env.ZOOM_CLIENT_SECRET || '',
    webhookSecret: config?.webhookSecret || process.env.ZOOM_WEBHOOK_SECRET || '',
  };

  const configHash = `${resolved.accountId}:${resolved.clientId}:${resolved.clientSecret}`;

  // Return cached provider if config hasn't changed
  if (cachedProvider && cachedConfigHash === configHash) {
    return cachedProvider;
  }

  const hasCredentials = !!(resolved.accountId && resolved.clientId && resolved.clientSecret);

  if (hasCredentials) {
    console.log('[Zoom Factory] Credentials found — using RealZoomProvider (live mode)');
    cachedProvider = new RealZoomProvider(
      resolved.accountId!,
      resolved.clientId!,
      resolved.clientSecret!
    );
  } else {
    const missing: string[] = [];
    if (!resolved.accountId) missing.push('ZOOM_ACCOUNT_ID');
    if (!resolved.clientId) missing.push('ZOOM_CLIENT_ID');
    if (!resolved.clientSecret) missing.push('ZOOM_CLIENT_SECRET');
    console.log(`[Zoom Factory] Missing credentials (${missing.join(', ')}) — using MockZoomProvider`);
    cachedProvider = new MockZoomProvider();
  }

  cachedConfigHash = configHash;
  return cachedProvider;
}

// ─── Webhook Verification ───────────────────────────────────────────────────

/**
 * Verify a Zoom webhook signature.
 * Returns true if the signature is valid, false otherwise.
 */
export function verifyWebhookSignature(
  requestBody: string,
  timestamp: string,
  signature: string,
  webhookSecret: string
): boolean {
  const message = `v0:${timestamp}:${requestBody}`;
  const hash = crypto.createHmac('sha256', webhookSecret)
    .update(message)
    .digest('hex');
  const expectedSignature = `v0=${hash}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Generate the CRC (Challenge-Response Check) response for Zoom webhook validation.
 * Zoom sends this when you first register a webhook URL and every 72 hours.
 */
export function generateCrcResponse(
  plainToken: string,
  webhookSecret: string
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = crypto.createHmac('sha256', webhookSecret)
    .update(plainToken)
    .digest('hex');
  return { plainToken, encryptedToken };
}

// ─── Meeting SDK Signature (HS256 JWT) ──────────────────────────────────────

/**
 * Build a Zoom Meeting SDK signature JWT (HS256) for the embedded Web/Native
 * Meeting SDK client join. This is distinct from Zoom S2S OAuth (meeting CRUD)
 * and from webhook HMAC — it is a self-signed JWT the client hands to the
 * Meeting SDK's join() call.
 *
 * Shape follows Zoom's current Signature v2 spec:
 *   header:  { alg: 'HS256', typ: 'JWT' }
 *   payload: { sdkKey, appKey: sdkKey, mn, role, iat, exp, tokenExp }
 *   signed with HS256(sdkSecret) over base64url(header) + "." + base64url(payload)
 *
 * Docs: https://developers.zoom.us/docs/meeting-sdk/auth/
 */
export function buildMeetingSdkSignature(params: {
  sdkKey: string;
  sdkSecret: string;
  meetingNumber: string | number;
  role: 0 | 1;
  ttlSeconds?: number;
}): string {
  const { sdkKey, sdkSecret, meetingNumber, role } = params;
  const ttl = params.ttlSeconds ?? 7200; // 2 hours; Zoom max is 48h
  const iat = Math.floor(Date.now() / 1000) - 30; // skew tolerance
  const exp = iat + ttl;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sdkKey,
    appKey: sdkKey,
    mn: String(meetingNumber),
    role,
    iat,
    exp,
    tokenExp: exp,
  };

  const b64url = (buf: Buffer) =>
    buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigB64 = b64url(
    crypto.createHmac('sha256', sdkSecret).update(signingInput).digest()
  );
  return `${signingInput}.${sigB64}`;
}

// ─── Session Event Types ────────────────────────────────────────────────────

export type SessionEventType =
  | 'meeting_created'
  | 'meeting_creation_failed'
  | 'meeting_updated'
  | 'meeting_deleted'
  | 'meeting_started'
  | 'meeting_ended'
  | 'participant_joined'
  | 'participant_left'
  | 'recording_started'
  | 'recording_completed'
  | 'recording_failed'
  | 'session_cancelled'
  | 'session_rescheduled'
  | 'allocation_success'
  | 'allocation_failed'
  | `zoom_unhandled_${string}`;

export interface SessionEvent {
  id?: string;
  occurrenceId: string;        // session_instances doc ID
  eventType: SessionEventType;
  source: 'system' | 'zoom_webhook' | 'coach_action' | 'admin_action';
  providerMode: 'mock' | 'live';
  zoomMeetingId?: string;
  zoomMeetingUuid?: string;
  timestamp: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  payload?: Record<string, unknown>;   // Raw event data for traceability
  idempotencyKey?: string;             // For deduplication
}

// ─── Recording Metadata Types ───────────────────────────────────────────────

export type RecordingStatus = 'processing' | 'available' | 'failed' | 'deleted';

export interface SessionRecording {
  id?: string;
  occurrenceId: string;            // session_instances doc ID
  zoomMeetingId: string;
  zoomMeetingUuid?: string;
  status: RecordingStatus;
  fileType?: string;               // e.g., 'MP4', 'M4A', 'CHAT'
  fileSize?: number;               // bytes
  playUrl?: string;                // Zoom playback URL
  downloadUrl?: string;            // Zoom download URL
  recordingStart?: string;         // ISO 8601
  recordingEnd?: string;           // ISO 8601
  processingStatus: 'pending' | 'ready' | 'error';
  reviewStatus: 'pending' | 'reviewed' | 'skipped';
  reviewedByCoachId?: string;
  reviewedAt?: FirebaseFirestore.Timestamp;
  rawPayload?: Record<string, unknown>;  // Full Zoom recording payload for traceability
  syncedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}
