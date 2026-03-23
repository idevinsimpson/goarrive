"use strict";
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
exports.MockZoomProvider = exports.RealZoomProvider = void 0;
exports.getZoomProvider = getZoomProvider;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.generateCrcResponse = generateCrcResponse;
const crypto = __importStar(require("crypto"));
let tokenCache = null;
/**
 * Get a valid S2S OAuth access token, using cache when possible.
 * Token TTL is 1 hour; we refresh 5 minutes early to avoid edge-case expiry.
 */
async function getS2SAccessToken(accountId, clientId, clientSecret) {
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
    const data = await response.json();
    tokenCache = {
        accessToken: data.access_token,
        expiresAt: now + data.expires_in * 1000,
    };
    console.log(`[Zoom S2S] Token acquired, expires in ${data.expires_in}s, scopes: ${data.scope}`);
    return tokenCache.accessToken;
}
// ─── RealZoomProvider ───────────────────────────────────────────────────────
class RealZoomProvider {
    constructor(accountId, clientId, clientSecret) {
        this.accountId = accountId;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.mode = 'live';
    }
    async getToken() {
        return getS2SAccessToken(this.accountId, this.clientId, this.clientSecret);
    }
    async apiRequest(method, path, body) {
        const token = await this.getToken();
        const url = `https://api.zoom.us/v2${path}`;
        const headers = {
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
    async createMeeting(request) {
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
        const data = await response.json();
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
    async deleteMeeting(meetingId) {
        const response = await this.apiRequest('DELETE', `/meetings/${meetingId}`);
        if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            throw new Error(`Zoom delete meeting failed (${response.status}): ${errorText}`);
        }
        console.log(`[Zoom Real] Meeting deleted: ${meetingId}`);
    }
    async getMeeting(meetingId) {
        const response = await this.apiRequest('GET', `/meetings/${meetingId}`);
        if (response.status === 404)
            return null;
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Zoom get meeting failed (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        return {
            meetingId: String(data.id),
            uuid: data.uuid,
            joinUrl: data.join_url,
            startUrl: data.start_url,
            password: data.password,
            hostEmail: data.host_email,
        };
    }
    async updateMeeting(meetingId, updates) {
        const body = {};
        if (updates.topic)
            body.topic = updates.topic;
        if (updates.startTime)
            body.start_time = updates.startTime;
        if (updates.duration)
            body.duration = updates.duration;
        if (updates.timezone)
            body.timezone = updates.timezone;
        const response = await this.apiRequest('PATCH', `/meetings/${meetingId}`, body);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Zoom update meeting failed (${response.status}): ${errorText}`);
        }
        console.log(`[Zoom Real] Meeting updated: ${meetingId}`);
    }
}
exports.RealZoomProvider = RealZoomProvider;
// ─── MockZoomProvider ───────────────────────────────────────────────────────
let mockCounter = 9000;
class MockZoomProvider {
    constructor() {
        this.mode = 'mock';
    }
    async createMeeting(request) {
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
    async deleteMeeting(meetingId) {
        console.log(`[Zoom Mock] Meeting deleted: ${meetingId}`);
    }
    async getMeeting(meetingId) {
        if (!meetingId.startsWith('mock-'))
            return null;
        return {
            meetingId,
            joinUrl: `https://zoom.us/j/${meetingId}`,
            startUrl: `https://zoom.us/s/${meetingId}`,
            password: 'mock123',
            hostEmail: 'mock@goarrive.fit',
            uuid: `mock-uuid-${meetingId}`,
        };
    }
    async updateMeeting(meetingId, _updates) {
        console.log(`[Zoom Mock] Meeting updated: ${meetingId}`);
    }
}
exports.MockZoomProvider = MockZoomProvider;
let cachedProvider = null;
let cachedConfigHash = null;
/**
 * Get the Zoom provider based on available configuration.
 * Returns RealZoomProvider if all S2S credentials are present, MockZoomProvider otherwise.
 *
 * Config is read from Firebase Functions config: functions.config().zoom
 * Or from environment variables: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 */
function getZoomProvider(config) {
    // Resolve config from params, env vars, or Firebase Functions config
    const resolved = {
        accountId: (config === null || config === void 0 ? void 0 : config.accountId) || process.env.ZOOM_ACCOUNT_ID || '',
        clientId: (config === null || config === void 0 ? void 0 : config.clientId) || process.env.ZOOM_CLIENT_ID || '',
        clientSecret: (config === null || config === void 0 ? void 0 : config.clientSecret) || process.env.ZOOM_CLIENT_SECRET || '',
        webhookSecret: (config === null || config === void 0 ? void 0 : config.webhookSecret) || process.env.ZOOM_WEBHOOK_SECRET || '',
    };
    const configHash = `${resolved.accountId}:${resolved.clientId}:${resolved.clientSecret}`;
    // Return cached provider if config hasn't changed
    if (cachedProvider && cachedConfigHash === configHash) {
        return cachedProvider;
    }
    const hasCredentials = !!(resolved.accountId && resolved.clientId && resolved.clientSecret);
    if (hasCredentials) {
        console.log('[Zoom Factory] Credentials found — using RealZoomProvider (live mode)');
        cachedProvider = new RealZoomProvider(resolved.accountId, resolved.clientId, resolved.clientSecret);
    }
    else {
        const missing = [];
        if (!resolved.accountId)
            missing.push('ZOOM_ACCOUNT_ID');
        if (!resolved.clientId)
            missing.push('ZOOM_CLIENT_ID');
        if (!resolved.clientSecret)
            missing.push('ZOOM_CLIENT_SECRET');
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
function verifyWebhookSignature(requestBody, timestamp, signature, webhookSecret) {
    const message = `v0:${timestamp}:${requestBody}`;
    const hash = crypto.createHmac('sha256', webhookSecret)
        .update(message)
        .digest('hex');
    const expectedSignature = `v0=${hash}`;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}
/**
 * Generate the CRC (Challenge-Response Check) response for Zoom webhook validation.
 * Zoom sends this when you first register a webhook URL and every 72 hours.
 */
function generateCrcResponse(plainToken, webhookSecret) {
    const encryptedToken = crypto.createHmac('sha256', webhookSecret)
        .update(plainToken)
        .digest('hex');
    return { plainToken, encryptedToken };
}
//# sourceMappingURL=zoom.js.map