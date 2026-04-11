/**
 * notifications.ts — GoArrive Communication Provider Boundary
 *
 * Provider-independent notification delivery system.
 * Supports email, SMS, and push channels through pluggable providers.
 * Mock providers are active by default; real providers activate when credentials are present.
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationChannel = 'email' | 'sms' | 'push';

export type DeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'canceled';

export type MessageType =
  | 'session_reminder'
  | 'session_starting_soon'
  | 'missed_session_followup'
  | 'recording_ready'
  | 'coach_session_reminder'
  | 'admin_alert'
  | 'skip_request_received'
  | 'skip_request_resolved'
  | 'workout_assigned'
  | 'workout_reviewed'
  | 'workout_completed';

export interface NotificationRecipient {
  uid: string;
  email?: string;
  phone?: string;
  displayName?: string;
  role: 'member' | 'coach' | 'admin';
}

export interface NotificationPayload {
  messageType: MessageType;
  channel: NotificationChannel;
  recipient: NotificationRecipient;
  subject?: string;
  body: string;
  htmlBody?: string;
  metadata?: Record<string, string>;
  sessionInstanceId?: string;
  coachId?: string;
  memberId?: string;
}

export interface DeliveryResult {
  success: boolean;
  providerMode: 'mock' | 'live';
  providerName: string;
  providerMessageId?: string;
  error?: string;
  sentAt?: admin.firestore.Timestamp;
  failedAt?: admin.firestore.Timestamp;
}

export interface NotificationRecord {
  id?: string;
  messageType: MessageType;
  channel: NotificationChannel;
  recipient: NotificationRecipient;
  subject?: string;
  body: string;
  htmlBody?: string;
  sessionInstanceId?: string;
  coachId?: string;
  memberId?: string;
  status: DeliveryStatus;
  providerMode: 'mock' | 'live';
  providerName: string;
  providerMessageId?: string;
  providerResponse?: string;
  providerError?: string;
  createdAt: admin.firestore.Timestamp;
  sentAt?: admin.firestore.Timestamp;
  failedAt?: admin.firestore.Timestamp;
  retryCount: number;
  metadata?: Record<string, string>;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface NotificationProvider {
  readonly name: string;
  readonly mode: 'mock' | 'live';
  readonly channel: NotificationChannel;
  send(payload: NotificationPayload): Promise<DeliveryResult>;
}

// ─── Mock Providers ──────────────────────────────────────────────────────────

let mockEmailCounter = 0;
let mockSmsCounter = 0;
let mockPushCounter = 0;

export class MockEmailProvider implements NotificationProvider {
  readonly name = 'mock-email';
  readonly mode = 'mock' as const;
  readonly channel = 'email' as const;

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    mockEmailCounter++;
    console.log(`[MockEmail] #${mockEmailCounter} → ${payload.recipient.email}: ${payload.subject}`);
    return {
      success: true,
      providerMode: 'mock',
      providerName: this.name,
      providerMessageId: `mock-email-${mockEmailCounter}-${Date.now()}`,
      sentAt: admin.firestore.Timestamp.now(),
    };
  }
}

export class MockSmsProvider implements NotificationProvider {
  readonly name = 'mock-sms';
  readonly mode = 'mock' as const;
  readonly channel = 'sms' as const;

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    mockSmsCounter++;
    console.log(`[MockSMS] #${mockSmsCounter} → ${payload.recipient.phone}: ${payload.body.substring(0, 80)}`);
    return {
      success: true,
      providerMode: 'mock',
      providerName: this.name,
      providerMessageId: `mock-sms-${mockSmsCounter}-${Date.now()}`,
      sentAt: admin.firestore.Timestamp.now(),
    };
  }
}

export class MockPushProvider implements NotificationProvider {
  readonly name = 'mock-push';
  readonly mode = 'mock' as const;
  readonly channel = 'push' as const;

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    mockPushCounter++;
    console.log(`[MockPush] #${mockPushCounter} → ${payload.recipient.uid}: ${payload.body.substring(0, 80)}`);
    return {
      success: true,
      providerMode: 'mock',
      providerName: this.name,
      providerMessageId: `mock-push-${mockPushCounter}-${Date.now()}`,
      sentAt: admin.firestore.Timestamp.now(),
    };
  }
}

// ─── Real Providers (activate when credentials are present) ──────────────────

/**
 * Real email provider using Resend, SendGrid, or similar.
 * Activates when EMAIL_API_KEY is set in Firebase config.
 */
export class RealEmailProvider implements NotificationProvider {
  readonly name = 'resend-email';
  readonly mode = 'live' as const;
  readonly channel = 'email' as const;
  private apiKey: string;
  private fromAddress: string;

  constructor(apiKey: string, fromAddress: string = 'sessions@goarrive.fit') {
    this.apiKey = apiKey;
    this.fromAddress = fromAddress;
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [payload.recipient.email],
          subject: payload.subject || 'GoArrive Session Update',
          html: payload.htmlBody || payload.body,
          text: payload.body,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return {
          success: false,
          providerMode: 'live',
          providerName: this.name,
          error: `Resend API error: ${res.status} — ${err}`,
          failedAt: admin.firestore.Timestamp.now(),
        };
      }
      const data = await res.json() as { id?: string };
      return {
        success: true,
        providerMode: 'live',
        providerName: this.name,
        providerMessageId: data.id || `resend-${Date.now()}`,
        sentAt: admin.firestore.Timestamp.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        providerMode: 'live',
        providerName: this.name,
        error: err.message || String(err),
        failedAt: admin.firestore.Timestamp.now(),
      };
    }
  }
}

/**
 * Real SMS provider using Twilio.
 * Activates when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER are set.
 */
export class RealSmsProvider implements NotificationProvider {
  readonly name = 'twilio-sms';
  readonly mode = 'live' as const;
  readonly channel = 'sms' as const;
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const body = new URLSearchParams({
        To: payload.recipient.phone || '',
        From: this.fromNumber,
        Body: payload.body,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      if (!res.ok) {
        const err = await res.text();
        return {
          success: false,
          providerMode: 'live',
          providerName: this.name,
          error: `Twilio API error: ${res.status} — ${err}`,
          failedAt: admin.firestore.Timestamp.now(),
        };
      }
      const data = await res.json() as { sid?: string };
      return {
        success: true,
        providerMode: 'live',
        providerName: this.name,
        providerMessageId: data.sid || `twilio-${Date.now()}`,
        sentAt: admin.firestore.Timestamp.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        providerMode: 'live',
        providerName: this.name,
        error: err.message || String(err),
        failedAt: admin.firestore.Timestamp.now(),
      };
    }
  }
}

// ─── Provider Factory ────────────────────────────────────────────────────────

export interface NotificationConfig {
  emailApiKey?: string;
  emailFromAddress?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
}

let _emailProvider: NotificationProvider | null = null;
let _smsProvider: NotificationProvider | null = null;
let _pushProvider: NotificationProvider | null = null;

export function getEmailProvider(config?: NotificationConfig): NotificationProvider {
  if (_emailProvider) return _emailProvider;
  const apiKey = config?.emailApiKey || process.env.EMAIL_API_KEY;
  if (apiKey) {
    _emailProvider = new RealEmailProvider(apiKey, config?.emailFromAddress);
  } else {
    _emailProvider = new MockEmailProvider();
  }
  return _emailProvider;
}

export function getSmsProvider(config?: NotificationConfig): NotificationProvider {
  if (_smsProvider) return _smsProvider;
  const sid = config?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = config?.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
  const from = config?.twilioFromNumber || process.env.TWILIO_FROM_NUMBER;
  if (sid && token && from) {
    _smsProvider = new RealSmsProvider(sid, token, from);
  } else {
    _smsProvider = new MockSmsProvider();
  }
  return _smsProvider;
}

export function getPushProvider(): NotificationProvider {
  if (_pushProvider) return _pushProvider;
  _pushProvider = new MockPushProvider();
  return _pushProvider;
}

/**
 * Reset cached providers so next call re-resolves from env/config.
 * Call at the start of CFs that declare secrets to ensure fresh resolution.
 */
export function resetNotificationProviders(): void {
  _emailProvider = null;
  _smsProvider = null;
  _pushProvider = null;
}

export function getProviderHealth(): {
  email: { mode: 'mock' | 'live'; name: string };
  sms: { mode: 'mock' | 'live'; name: string };
  push: { mode: 'mock' | 'live'; name: string };
} {
  return {
    email: { mode: getEmailProvider().mode, name: getEmailProvider().name },
    sms: { mode: getSmsProvider().mode, name: getSmsProvider().name },
    push: { mode: getPushProvider().mode, name: getPushProvider().name },
  };
}

// ─── Delivery Engine ─────────────────────────────────────────────────────────

/**
 * Send a notification through the appropriate provider and persist the record.
 * Returns the notification record ID.
 */
export async function sendNotification(payload: NotificationPayload): Promise<string> {
  let provider: NotificationProvider;
  switch (payload.channel) {
    case 'email': provider = getEmailProvider(); break;
    case 'sms': provider = getSmsProvider(); break;
    case 'push': provider = getPushProvider(); break;
    default: provider = getEmailProvider();
  }

  const record: NotificationRecord = {
    messageType: payload.messageType,
    channel: payload.channel,
    recipient: payload.recipient,
    subject: payload.subject,
    body: payload.body,
    htmlBody: payload.htmlBody,
    sessionInstanceId: payload.sessionInstanceId,
    coachId: payload.coachId,
    memberId: payload.memberId,
    status: 'pending',
    providerMode: provider.mode,
    providerName: provider.name,
    createdAt: admin.firestore.Timestamp.now(),
    retryCount: 0,
    metadata: payload.metadata,
  };

  // Persist pending record
  const ref = await db.collection('notification_log').add(record);

  try {
    const result = await provider.send(payload);
    if (result.success) {
      await ref.update({
        status: 'sent',
        providerMessageId: result.providerMessageId || null,
        sentAt: result.sentAt || admin.firestore.Timestamp.now(),
      });
    } else {
      await ref.update({
        status: 'failed',
        providerError: result.error || 'Unknown delivery failure',
        failedAt: result.failedAt || admin.firestore.Timestamp.now(),
      });
      // Write to dead_letter for operational visibility
      await db.collection('dead_letter').add({
        type: 'notification_delivery_failed',
        sourceCollection: 'notification_log',
        sourceId: ref.id,
        error: result.error,
        payload: { messageType: payload.messageType, channel: payload.channel, recipientUid: payload.recipient.uid },
        createdAt: admin.firestore.Timestamp.now(),
        resolved: false,
      });
    }
  } catch (err: any) {
    await ref.update({
      status: 'failed',
      providerError: err.message || String(err),
      failedAt: admin.firestore.Timestamp.now(),
    });
    await db.collection('dead_letter').add({
      type: 'notification_delivery_failed',
      sourceCollection: 'notification_log',
      sourceId: ref.id,
      error: err.message || String(err),
      payload: { messageType: payload.messageType, channel: payload.channel, recipientUid: payload.recipient.uid },
      createdAt: admin.firestore.Timestamp.now(),
      resolved: false,
    });
  }

  return ref.id;
}

// ─── Reset (for testing) ────────────────────────────────────────────────────

export function resetProviders(): void {
  _emailProvider = null;
  _smsProvider = null;
  _pushProvider = null;
}
