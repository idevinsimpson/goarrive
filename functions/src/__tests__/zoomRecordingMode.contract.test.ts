import { RealZoomProvider } from '../zoom';

afterEach(() => jest.restoreAllMocks());
test.each(['none', 'cloud', 'local', undefined])('recording receipt reflects provider response %s, not the requested mode', async mode => {
  jest.spyOn(global, 'fetch').mockImplementation(async input => ({ ok: true, status: 200, json: async () => String(input).includes('/oauth/token') ? { access_token: 'synthetic', expires_in: 3600 } : { id: 1, join_url: 'https://example.invalid/join', settings: mode ? { auto_recording: mode } : {} } } as Response));
  const provider = new RealZoomProvider('synthetic', 'synthetic', 'synthetic');
  const created = await provider.createMeeting({ topic: 'Synthetic', startTime: '2026-11-01T00:00:00Z', duration: 45, timezone: 'UTC', hostEmail: 'synthetic@example.invalid', autoRecording: 'none' });
  expect(created.recordingMode).toBe(mode || 'unknown');
  expect((await provider.getMeeting('1'))?.recordingMode).toBe(mode || 'unknown');
});
