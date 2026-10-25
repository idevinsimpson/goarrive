import { boundedGuestMediaRange as range, guestMediaObjectPath as object } from '../guestMediaBoundary';
test('accepts only canonical references in the owning coach namespace', () => {
  expect(object('movements/coach/demo.mp4', 'coach')).toBe('movements/coach/demo.mp4');
  expect(object('workouts/coach/intro.mp4', 'coach')).toBe('workouts/coach/intro.mp4');
  for (const value of ['movements/other/a.mp4', 'https://storage.example/a?token=secret', 'http://127.0.0.1/private', 'gs://bucket/movements/coach/a', 'movements/coach/../other/a', 'movements/coach/%2e%2e/a', 'movements/coach/a?token=x', 'movements/coach/a#x', 'movements/coach/a\\b', 'movements/coach//a', 'voice_cache/coaches/coach/a']) expect(object(value, 'coach')).toBeUndefined();
});
test('requires explicit bounded single byte range and safe file size', () => {
  expect(range('bytes=0-999', 1000)).toEqual({ start: 0, end: 999 });
  for (const value of [undefined, 'bytes=0-', 'bytes=-100', 'bytes=0-1,3-4', 'bytes=5-2', 'bytes=0-1000', 'bytes=0-9007199254740999']) expect(range(value, 1000)).toBeUndefined();
  expect(range('bytes=0-1048576', 2000000)).toBeUndefined();
  expect(range('bytes=0-1', 200000000)).toBeUndefined();
});
