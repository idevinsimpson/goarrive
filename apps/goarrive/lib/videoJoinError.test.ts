import { expect, it } from 'vitest';
import { videoJoinError } from './videoJoinError';
it('shows only the stage and numeric Zoom error code', () => {
  expect(videoJoinError('join', { errorCode: 3000, message: 'SECRET', signature: 'PRIVATE' })).toBe('Video could not connect while joining Zoom (code 3000). Retry or continue your workout.');
  expect(videoJoinError('access', { code: 'functions/permission-denied', message: 'PRIVATE' })).not.toMatch(/PRIVATE|permission/);
  expect(videoJoinError('initialize', { errorCode: 'https://secret.invalid' })).not.toContain('secret');
});
