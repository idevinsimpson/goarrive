"use strict";
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
exports.RTMS_MSG_TYPE = void 0;
exports.exchangeOAuthCode = exchangeOAuthCode;
exports.refreshOAuthTokens = refreshOAuthTokens;
exports.verifyRtmsWebhookSignature = verifyRtmsWebhookSignature;
exports.buildRtmsCrcResponse = buildRtmsCrcResponse;
exports.buildRtmsHandshakeSignature = buildRtmsHandshakeSignature;
exports.mediaTypeBitmask = mediaTypeBitmask;
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
const crypto = __importStar(require("crypto"));
// ─── OAuth: authorization code → tokens ─────────────────────────────────────
/**
 * Exchange an authorization code for access + refresh tokens.
 * Per Zoom docs: POST https://zoom.us/oauth/token with grant_type=authorization_code.
 */
async function exchangeOAuthCode(params) {
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
    return response.json();
}
/**
 * Refresh an expired access token using a stored refresh_token.
 * Zoom rotates the refresh_token on each refresh — caller MUST persist both.
 */
async function refreshOAuthTokens(params) {
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
    return response.json();
}
// ─── Webhook signature verification (RTMS app uses Secret Token / HMAC) ─────
/**
 * Verify a Zoom webhook signature for the RTMS app.
 * Header format:  v0=<hex(hmac_sha256(secret, "v0:" + ts + ":" + body))>
 * Returns false on any malformed input — never throws.
 */
function verifyRtmsWebhookSignature(args) {
    if (!args.signature || !args.timestamp || !args.secretToken)
        return false;
    const message = `v0:${args.timestamp}:${args.rawBody}`;
    const hash = crypto
        .createHmac('sha256', args.secretToken)
        .update(message)
        .digest('hex');
    const expected = `v0=${hash}`;
    const a = Buffer.from(args.signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(a, b);
}
/**
 * Build the CRC challenge response for endpoint.url_validation events.
 * Zoom expects { plainToken, encryptedToken } where encryptedToken is the
 * hex HMAC-SHA256 of plainToken using the Secret Token.
 */
function buildRtmsCrcResponse(plainToken, secretToken) {
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
function buildRtmsHandshakeSignature(args) {
    const message = `${args.clientId},${args.meetingUuid},${args.streamId}`;
    return crypto
        .createHmac('sha256', args.clientSecret)
        .update(message)
        .digest('hex');
}
// ─── RTMS message types (subset used by the worker) ─────────────────────────
exports.RTMS_MSG_TYPE = {
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
};
function mediaTypeBitmask(types) {
    let mask = 0;
    for (const t of types) {
        if (t === 'audio' || t === 'all')
            mask |= 1;
        if (t === 'video' || t === 'all')
            mask |= 2;
        if (t === 'transcript' || t === 'all')
            mask |= 4;
    }
    return mask;
}
//# sourceMappingURL=zoomRtms.js.map