import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { RealZoomProvider, MockZoomProvider } from '../zoom';

const marker = 'synthetic-host-only-capability';
const wireMeeting = { id: 12345, uuid: 'synthetic-uuid', join_url: 'https://example.invalid/join', start_url: `https://example.invalid/host?zak=${marker}`, password: 'synthetic-join-password', host_email: 'host@example.invalid' };
beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation(async input => ({ ok: true, status: 200, json: async () => String(input).includes('/oauth/token')
    ? { access_token: 'synthetic-token', expires_in: 3600, scope: 'synthetic' } : wireMeeting } as Response));
});
afterEach(() => jest.restoreAllMocks());

test('real provider create/get project participant fields and discard host capabilities from API responses', async () => {
  const provider = new RealZoomProvider('synthetic-account', 'synthetic-client', 'synthetic-secret');
  const created = await provider.createMeeting({ topic: 'Synthetic only', startTime: '2026-11-01T12:00:00Z', duration: 45, timezone: 'UTC', hostEmail: 'host@example.invalid' });
  const fetched = await provider.getMeeting('12345');
  for (const response of [created, fetched]) {
    expect(response).toMatchObject({ meetingId: '12345', joinUrl: wireMeeting.join_url, password: wireMeeting.password });
    expect(response).not.toHaveProperty('startUrl');
    expect(response).not.toHaveProperty('start_url');
    expect(JSON.stringify(response)).not.toContain(marker);
  }
});

test('mock provider does not encourage persisting a host-start field', async () => {
  const provider = new MockZoomProvider();
  const created = await provider.createMeeting({ topic: 'Synthetic', startTime: '2026-11-01T12:00:00Z', duration: 45, timezone: 'UTC', hostEmail: 'host@example.invalid' });
  expect(created).not.toHaveProperty('startUrl');
  expect(await provider.getMeeting(created.meetingId)).not.toHaveProperty('startUrl');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('both real allocator update objects delete stale host URLs; reschedule deletion remains', () => {
  const source = ts.createSourceFile('index.ts', fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const allocations: ts.PropertyAssignment[] = [], all: ts.PropertyAssignment[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'zoomStartUrl') {
      all.push(node);
      if (node.parent.getText(source).includes("status: 'allocated'")) allocations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(allocations).toHaveLength(2);
  expect(all).toHaveLength(3);
  const deletion = Symbol('Firestore delete');
  for (const property of all) {
    expect(property.initializer.getText(source)).toBe('FieldValue.delete()');
    expect(new Function('FieldValue', `return (${property.initializer.getText(source)});`)({ delete: () => deletion })).toBe(deletion);
  }
});
