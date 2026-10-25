import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
test('legacy tile and beta join remain byte-identical to released source', () => {
  const normalizedHash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  expect(normalizedHash('apps/goarrive/components/SessionZoomTile.tsx')).toBe('aa3f229bd7652ef4b4a580d329b53b8ce0f1ac24bcf2bd0494e57d59fcbb9896');
  expect(normalizedHash('apps/goarrive/app/join/[sessionInstanceId].tsx')).toBe('f9e6b77d95cf207b8c67e8bc55516a2c722b2b0f4307ea143e3b9f03e5fc70a8');
});
test('recorded entry is routed before legacy mount; coach live-view keeps legacy tile', () => {
  const member = fs.readFileSync(path.resolve(__dirname, '../../../apps/goarrive/app/live-session/[sessionInstanceId].tsx'), 'utf8');
  const coach = fs.readFileSync(path.resolve(__dirname, '../../../apps/goarrive/app/live-view/[sessionInstanceId].tsx'), 'utf8');
  expect(member).toContain('inst.recordingEnabled === true && (');
  expect(member).toContain('<RecordedSessionVideoEntry');
  expect(member).toContain('zoomOverlay={!completing');
  expect(member).toContain('<WorkoutVideoOverlay key=');
  expect(coach).toContain('components/SessionZoomTile');
  expect(coach).not.toContain('WorkoutVideoOverlay');
});
