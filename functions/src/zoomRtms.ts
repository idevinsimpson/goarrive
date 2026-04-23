/**
 * GoArrive — Zoom RTMS (Real-Time Media Streaming) Module
 *
 * Captures live audio + transcript segments from Zoom meetings via Zoom's RTMS
 * WebSocket API. Backed by a separate Zoom Marketplace "General App" (not the
 * existing S2S OAuth app, which can only manage meetings — it cannot open
 * RTMS WebSockets).
 *
 * Required Firebase secrets (set per environment):
 *   ZOOM_RTMS_CLIENT_ID        — Marketplace app OAuth client id
 *   ZOOM_RTMS_CLIENT_SECRET    — Marketplace app OAuth client secret
 *   ZOOM_RTMS_SECRET_TOKEN     — Webhook secret token (for HMAC verification)
 *   ZOOM_RTMS_OAUTH_REDIRECT   — Redirect URI registered in the Zoom app
 *
 * Staging deploys use the Zoom Dev credentials; production uses Prod.
 */
import * as crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  api_url?: string;
}

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresAt: number;       // Unix ms — server time when access_token expires
  apiUrl?: string;
  installedBy?: string;    // Zoom user id who installed
  accountId?: string;
}

export type RtmsSessionStatus =
  | 'pending_connect'   // rtms_started received, worker not yet connected
  | 'connecting'        // worker fetching signaling URL / opening WS
  | 'active'            // media handshake complete, receiving data
  | 'ended'             // meeting.ended or rtms_stopped
  | 'failed';           // worker hit an error

export interface RtmsSessionDoc {
  meetingId: string;
  meetingUuid?: string;
  streamId: string;
  hostId?: string;
  topic?: string;
  status: RtmsSessionStatus;
  startedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp;
  endedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  lastError?: string | null;
  segmentCount?: number;
}

export interface TranscriptSegmentDoc {
  speaker: string;
  text: string;
  confidence?: number;
  ts: number;             // Server-side receive ms
  startMs?: number;       // Optional Zoom-provided start offset
  endMs?: number;         // Optional Zoom-provided end offset
}

// ─── OAuth: authorization code → tokens ─────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 * Per Zoom docs: POST https://zoom.us/oauth/token with grant_type=authorization_code.
 */
export async function exchangeOAuthCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OAuthTokenResponse> {
  const credentials = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
  }).toString();

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Zoom OAuth code exchange failed (${response.status}): ${errText}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

/**
 * Refresh an expired access token using a stored refresh_token.
 * Zoom rotates the refresh_token on each refresh — caller MUST persist both.
 */
export async function refreshOAuthTokens(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OAuthTokenResponse> {
  const credentials = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  }).toString();

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Zoom OAuth refresh failed (${response.status}): ${errText}`);
  }

  return response.json() as Promise<OAuthTokenResponse>;
}

// ─── Webhook signature verification (RTMS app uses Secret Token / HMAC) ─────

/**
 * Verify a Zoom webhook signature for the RTMS app.
 * Header format:  v0=<hex(hmac_sha256(secret, "v0:" + ts + ":" + body))>
 * Returns false on any malformed input — never throws.
 */
export function verifyRtmsWebhookSignature(args: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secretToken: string;
}): boolean {
  if (!args.signature || !args.timestamp || !args.secretToken) return false;
  const message = `v0:${args.timestamp}:${args.rawBody}`;
  const hash = crypto
    .createHmac('sha256', args.secretToken)
    .update(message)
    .digest('hex');
  const expected = `v0=${hash}`;
  const a = Buffer.from(args.signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Build the CRC challenge response for endpoint.url_validation events.
 * Zoom expects { plainToken, encryptedToken } where encryptedToken is the
 * hex HMAC-SHA256 of plainToken using the Secret Token.
 */
export function buildRtmsCrcResponse(
  plainToken: string,
  secretToken: string
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = crypto
    .createHmac('sha256', secretToken)
    .update(plainToken)
    .digest('hex');
  return { plainToken, encryptedToken };
}

// ─── RTMS handshake signature ───────────────────────────────────────────────

/**
 * RTMS signaling handshake requires a signature derived from the meeting
 * context using the Marketplace app's client_secret as the HMAC key.
 *
 *   signature = HMAC_SHA256(client_secret, clientId + "," + meetingUuid + "," + streamId)
 *
 * Encoded as lowercase hex per the public RTMS docs.
 */
export function buildRtmsHandshakeSignature(args: {
  clientId: string;
  clientSecret: string;
  meetingUuid: string;
  streamId: string;
}): string {
  const message = `${args.clientId},${args.meetingUuid},${args.streamId}`;
  return crypto
    .createHmac('sha256', args.clientSecret)
    .update(message)
    .digest('hex');
}

// ─── RTMS message types (subset used by the worker) ─────────────────────────

export const RTMS_MSG_TYPE = {
  SIGNALING_HAND_SHAKE_REQ: 1,
  SIGNALING_HAND_SHAKE_RESP: 2,
  DATA_HAND_SHAKE_REQ: 3,
  DATA_HAND_SHAKE_RESP: 4,
  EVENT_SUBSCRIPTION: 5,
  EVENT_UPDATE: 6,
  CLIENT_READY_ACK: 7,
  STREAM_STATE_UPDATE: 8,
  SESSION_STATE_UPDATE: 9,
  SESSION_STATE_REQ: 10,
  SESSION_STATE_RESP: 11,
  KEEP_ALIVE_REQ: 12,
  KEEP_ALIVE_RESP: 13,
  MEDIA_DATA_AUDIO: 14,
  MEDIA_DATA_VIDEO: 15,
  MEDIA_DATA_SHARE: 16,
  MEDIA_DATA_TRANSCRIPT: 17,
} as const;

export type RtmsMediaType = 'audio' | 'video' | 'transcript' | 'all';

export interface RtmsHandshakeRequest {
  msg_type: number;
  protocol_version: number;
  meeting_uuid: string;
  rtms_stream_id: string;
  signature: string;
}

export interface RtmsDataHandshakeRequest {
  msg_type: number;
  protocol_version: number;
  meeting_uuid: string;
  rtms_stream_id: string;
  signature: string;
  media_type: number;          // bitmask: 1=audio, 2=video, 4=transcript
  payload_encryption: boolean;
  media_params?: Record<string, unknown>;
}

export function mediaTypeBitmask(types: RtmsMediaType[]): number {
  let mask = 0;
  for (const t of types) {
    if (t === 'audio' || t === 'all') mask |= 1;
    if (t === 'video' || t === 'all') mask |= 2;
    if (t === 'transcript' || t === 'all') mask |= 4;
  }
  return mask;
}
