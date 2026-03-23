"use strict";
/**
 * notifications.ts — GoArrive Communication Provider Boundary
 *
 * Provider-independent notification delivery system.
 * Supports email, SMS, and push channels through pluggable providers.
 * Mock providers are active by default; real providers activate when credentials are present.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealSmsProvider = exports.RealEmailProvider = exports.MockPushProvider = exports.MockSmsProvider = exports.MockEmailProvider = void 0;
exports.getEmailProvider = getEmailProvider;
exports.getSmsProvider = getSmsProvider;
exports.getPushProvider = getPushProvider;
exports.getProviderHealth = getProviderHealth;
exports.sendNotification = sendNotification;
exports.resetProviders = resetProviders;
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
// ─── Mock Providers ──────────────────────────────────────────────────────────
let mockEmailCounter = 0;
let mockSmsCounter = 0;
let mockPushCounter = 0;
class MockEmailProvider {
    constructor() {
        this.name = 'mock-email';
        this.mode = 'mock';
        this.channel = 'email';
    }
    async send(payload) {
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
exports.MockEmailProvider = MockEmailProvider;
class MockSmsProvider {
    constructor() {
        this.name = 'mock-sms';
        this.mode = 'mock';
        this.channel = 'sms';
    }
    async send(payload) {
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
exports.MockSmsProvider = MockSmsProvider;
class MockPushProvider {
    constructor() {
        this.name = 'mock-push';
        this.mode = 'mock';
        this.channel = 'push';
    }
    async send(payload) {
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
exports.MockPushProvider = MockPushProvider;
// ─── Real Providers (activate when credentials are present) ──────────────────
/**
 * Real email provider using Resend, SendGrid, or similar.
 * Activates when EMAIL_API_KEY is set in Firebase config.
 */
class RealEmailProvider {
    constructor(apiKey, fromAddress = 'sessions@goarrive.fit') {
        this.name = 'resend-email';
        this.mode = 'live';
        this.channel = 'email';
        this.apiKey = apiKey;
        this.fromAddress = fromAddress;
    }
    async send(payload) {
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
            const data = await res.json();
            return {
                success: true,
                providerMode: 'live',
                providerName: this.name,
                providerMessageId: data.id || `resend-${Date.now()}`,
                sentAt: admin.firestore.Timestamp.now(),
            };
        }
        catch (err) {
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
exports.RealEmailProvider = RealEmailProvider;
/**
 * Real SMS provider using Twilio.
 * Activates when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER are set.
 */
class RealSmsProvider {
    constructor(accountSid, authToken, fromNumber) {
        this.name = 'twilio-sms';
        this.mode = 'live';
        this.channel = 'sms';
        this.accountSid = accountSid;
        this.authToken = authToken;
        this.fromNumber = fromNumber;
    }
    async send(payload) {
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
            const data = await res.json();
            return {
                success: true,
                providerMode: 'live',
                providerName: this.name,
                providerMessageId: data.sid || `twilio-${Date.now()}`,
                sentAt: admin.firestore.Timestamp.now(),
            };
        }
        catch (err) {
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
exports.RealSmsProvider = RealSmsProvider;
let _emailProvider = null;
let _smsProvider = null;
let _pushProvider = null;
function getEmailProvider(config) {
    if (_emailProvider)
        return _emailProvider;
    const apiKey = (config === null || config === void 0 ? void 0 : config.emailApiKey) || process.env.EMAIL_API_KEY;
    if (apiKey) {
        _emailProvider = new RealEmailProvider(apiKey, config === null || config === void 0 ? void 0 : config.emailFromAddress);
    }
    else {
        _emailProvider = new MockEmailProvider();
    }
    return _emailProvider;
}
function getSmsProvider(config) {
    if (_smsProvider)
        return _smsProvider;
    const sid = (config === null || config === void 0 ? void 0 : config.twilioAccountSid) || process.env.TWILIO_ACCOUNT_SID;
    const token = (config === null || config === void 0 ? void 0 : config.twilioAuthToken) || process.env.TWILIO_AUTH_TOKEN;
    const from = (config === null || config === void 0 ? void 0 : config.twilioFromNumber) || process.env.TWILIO_FROM_NUMBER;
    if (sid && token && from) {
        _smsProvider = new RealSmsProvider(sid, token, from);
    }
    else {
        _smsProvider = new MockSmsProvider();
    }
    return _smsProvider;
}
function getPushProvider() {
    if (_pushProvider)
        return _pushProvider;
    _pushProvider = new MockPushProvider();
    return _pushProvider;
}
function getProviderHealth() {
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
async function sendNotification(payload) {
    let provider;
    switch (payload.channel) {
        case 'email':
            provider = getEmailProvider();
            break;
        case 'sms':
            provider = getSmsProvider();
            break;
        case 'push':
            provider = getPushProvider();
            break;
        default: provider = getEmailProvider();
    }
    const record = {
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
        }
        else {
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
    }
    catch (err) {
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
function resetProviders() {
    _emailProvider = null;
    _smsProvider = null;
    _pushProvider = null;
}
//# sourceMappingURL=notifications.js.map