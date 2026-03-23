/**
 * zoomProvider.ts — Zoom Provider Boundary for GoArrive Scheduling
 *
 * This module defines the provider interface and implementations for
 * creating/managing Zoom meetings. Two implementations:
 *
 *   1. MockZoomProvider — Generates realistic-looking mock data for
 *      development and testing. No real Zoom API calls.
 *
 *   2. RealZoomProvider — (Scaffolded) Will use Zoom Server-to-Server
 *      OAuth to create actual private meetings. Requires Zoom app
 *      credentials and OAuth consent (ME step).
 *
 * The active provider is selected via getZoomProvider().
 */

import type { ZoomProvider, ZoomMeetingRequest, ZoomMeetingResponse } from './schedulingTypes';

// ─── Mock Zoom Provider ──────────────────────────────────────────────────────

let mockMeetingCounter = 1000;

export class MockZoomProvider implements ZoomProvider {
  async createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse> {
    // Simulate a small delay like a real API call
    await new Promise(resolve => setTimeout(resolve, 100));

    const meetingId = `mock-${Date.now()}-${++mockMeetingCounter}`;
    const password = Math.random().toString(36).substring(2, 8);

    return {
      meetingId,
      joinUrl: `https://zoom.us/j/${meetingId}?pwd=${password}`,
      startUrl: `https://zoom.us/s/${meetingId}?zak=mock_host_token_${meetingId}`,
      password,
      hostEmail: request.zoomUserId || 'mock@goarrive.fit',
    };
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    // No-op for mock
    console.log(`[MockZoomProvider] deleteMeeting called for ${meetingId}`);
  }

  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null> {
    // Mock always returns null (meeting not found) since we don't persist mock meetings
    console.log(`[MockZoomProvider] getMeeting called for ${meetingId}`);
    return null;
  }
}

// ─── Real Zoom Provider (Scaffolded) ─────────────────────────────────────────
//
// ME STEP REQUIRED: To activate the real Zoom provider:
//   1. Create a Zoom Server-to-Server OAuth app at https://marketplace.zoom.us/
//   2. Set the following Firebase secrets:
//      firebase functions:secrets:set ZOOM_ACCOUNT_ID
//      firebase functions:secrets:set ZOOM_CLIENT_ID
//      firebase functions:secrets:set ZOOM_CLIENT_SECRET
//   3. Update getZoomProvider() to return RealZoomProvider
//
// The real provider will:
//   - Use Server-to-Server OAuth to get an access token
//   - Call POST /users/{userId}/meetings to create private meetings
//   - Call DELETE /meetings/{meetingId} to cancel meetings
//   - Call GET /meetings/{meetingId} to check meeting status
//

export class RealZoomProvider implements ZoomProvider {
  private accountId: string;
  private clientId: string;
  private clientSecret: string;

  constructor(accountId: string, clientId: string, clientSecret: string) {
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getAccessToken(): Promise<string> {
    // Server-to-Server OAuth: POST https://zoom.us/oauth/token
    // grant_type=account_credentials&account_id={accountId}
    // Authorization: Basic base64(clientId:clientSecret)
    throw new Error(
      '[RealZoomProvider] Not yet activated. ME step required: Zoom OAuth credentials must be configured.'
    );
  }

  async createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeetingResponse> {
    const _token = await this.getAccessToken();
    // POST https://api.zoom.us/v2/users/{userId}/meetings
    // Body: { topic, type: 2, start_time, duration, timezone, settings: { ... } }
    throw new Error('[RealZoomProvider] createMeeting not yet implemented');
  }

  async deleteMeeting(meetingId: string): Promise<void> {
    const _token = await this.getAccessToken();
    // DELETE https://api.zoom.us/v2/meetings/{meetingId}
    throw new Error('[RealZoomProvider] deleteMeeting not yet implemented');
  }

  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse | null> {
    const _token = await this.getAccessToken();
    // GET https://api.zoom.us/v2/meetings/{meetingId}
    throw new Error('[RealZoomProvider] getMeeting not yet implemented');
  }
}

// ─── Provider Factory ────────────────────────────────────────────────────────

// Set to 'mock' for development/testing, 'real' when Zoom OAuth is configured
const ZOOM_PROVIDER_MODE: 'mock' | 'real' = 'mock';

let _provider: ZoomProvider | null = null;

export function getZoomProvider(): ZoomProvider {
  if (!_provider) {
    if (ZOOM_PROVIDER_MODE === 'real') {
      // These would come from environment/secrets in production
      _provider = new RealZoomProvider('', '', '');
    } else {
      _provider = new MockZoomProvider();
    }
  }
  return _provider;
}
