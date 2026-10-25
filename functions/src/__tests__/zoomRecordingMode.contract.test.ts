import { RealZoomProvider } from '../zoom';

afterEach(() => jest.restoreAllMocks());
test.each(['none', 'cloud', 'local', undefined])('recording receipt reflects provider response %s, not the requested mode', async mode => {
  jest.spyOn(global, 'fetch').mockImplementation(async input => ({ ok: true, status: 200, json: async () => String(input).includes('/oauth/token') ? { access_token: 'synthetic', expires_in: 3600 } : { id: 1, join_url: 'https://example.invalid/join', settings: mode ? { auto_recording: mode } : {} } } as Response));
  const provider = new RealZoomProvider('synthetic', 'synthetic', 'synthetic');
  const created = await provider.createMeeting({ topic: 'Synthetic', startTime: '2026-11-01T00:00:00Z', duration: 45, timezone: 'UTC', hostEmail: 'synthetic@example.invalid', autoRecording: 'none' });
  expect(created.recordingMode).toBe(mode || 'unknown');
  expect((await provider.getMeeting('1'))?.recordingMode).toBe(mode || 'unknown');
});

test('camera creation default is explicitly off and effective response must confirm it', async () => {
  const calls: any[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => { calls.push({ url: String(url), body: options?.body }); return { ok: true, status: 200, json: async () => String(url).includes('/oauth/token') ? { access_token: 'synthetic', expires_in: 3600 } : { id: 1, settings: { auto_recording: 'none', participant_video: false } } } as Response; });
  const provider = new RealZoomProvider('synthetic', 'synthetic', 'synthetic');
  const meeting = await provider.createMeeting({ topic: 'Synthetic', startTime: '2026-11-01T00:00:00Z', duration: 45, timezone: 'UTC', hostEmail: 'synthetic@example.invalid', autoRecording: 'none' });
  expect(JSON.parse(calls.find(x => x.url.includes('/meetings')).body).settings.participant_video).toBe(false);
  expect(JSON.parse(calls.find(x => x.url.includes('/meetings')).body).settings.approval_type).toBe(2);
  expect(meeting.participantVideoOff).toBe(true);
});

test('embedded meetings do not require registration tokens; recording and manual media defaults stay intact', async () => {
  const requests: any[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => String(url).includes('/oauth/token')
      ? { access_token: 'synthetic', expires_in: 3600 }
      : { id: 1, settings: { approval_type: 2, auto_recording: 'cloud', participant_video: false } } } as Response;
  });
  await new RealZoomProvider('synthetic', 'synthetic', 'synthetic').createMeeting({ topic: 'Synthetic', startTime: '2026-10-25T18:40:00Z', duration: 45, timezone: 'America/New_York', hostEmail: 'host@example.invalid', autoRecording: 'cloud' });
  const meetings = requests.filter(r => r.url.endsWith('/meetings'));
  expect(meetings).toHaveLength(1);
  expect(JSON.parse(meetings[0].options.body).settings).toEqual({ join_before_host: true, waiting_room: false, auto_recording: 'cloud', mute_upon_entry: true, participant_video: false, approval_type: 2 });
  expect(requests.some(r => r.url.includes('registrants'))).toBe(false);
});


test.each([
  [{ waiting_room: false, join_before_host: true, approval_type: 2 }, true],
  [{ waiting_room: true, join_before_host: true, approval_type: 2 }, false],
  [{ waiting_room: false, join_before_host: false, approval_type: 2 }, false],
  [{ waiting_room: false, join_before_host: true, approval_type: 0 }, false],
  [{}, false],
])('effective unattended settings are verified, not assumed: %j', async (settings, ready) => {
  let posted: any;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).includes('/oauth/token')) return { ok: true, json: async () => ({ access_token: 'synthetic', expires_in: 3600 }) } as Response;
    posted = JSON.parse(String(options?.body));
    return { ok: true, json: async () => ({ id: 1, password: 'provider-effective-passcode', settings }) } as Response;
  });
  const result = await new RealZoomProvider('synthetic', 'synthetic', 'synthetic').createMeeting({ topic: 'Synthetic', startTime: '2026-10-25T18:40:00Z', duration: 45, timezone: 'UTC', hostEmail: 'host@example.invalid' });
  expect(posted.password).toMatch(/^[a-f0-9]{10}$/);
  expect(posted.settings.waiting_room).toBe(false);
  expect(result.password).toBe('provider-effective-passcode');
  expect(result.unattendedReady).toBe(ready);
});

test('provider error bodies cannot leak a meeting passcode into allocator logs', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async url => String(url).includes('/oauth/token')
    ? { ok: true, json: async () => ({ access_token: 'synthetic', expires_in: 3600 }) } as Response
    : { ok: false, status: 400, text: async () => 'sensitive-passcode-sentinel' } as Response);
  await expect(new RealZoomProvider('synthetic', 'synthetic', 'synthetic').createMeeting({ topic: 'Synthetic', startTime: '2026-10-25T18:40:00Z', duration: 45, timezone: 'UTC', hostEmail: 'host@example.invalid' })).rejects.toThrow(/^Zoom create meeting failed \(400\)$/);
});


test('effective settings without an effective passcode cannot admit unattended video', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async url => ({ ok: true, json: async () => String(url).includes('/oauth/token') ? { access_token: 'synthetic', expires_in: 3600 } : { id: 1, password: '', settings: { waiting_room: false, join_before_host: true, approval_type: 2 } } } as Response));
  const result = await new RealZoomProvider('synthetic', 'synthetic', 'synthetic').createMeeting({ topic: 'Synthetic', startTime: '2026-10-25T18:40:00Z', duration: 45, timezone: 'UTC', hostEmail: 'host@example.invalid' });
  expect(result.unattendedReady).toBe(false);
  expect(result.password).toBe('');
});
