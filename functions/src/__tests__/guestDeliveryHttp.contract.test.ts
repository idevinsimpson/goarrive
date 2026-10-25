import { guestDeliveryHttp } from '../guestDeliveryHttp';
function fixture() {
  const service: any = { manifest: jest.fn(async () => ({ revision: 'a'.repeat(64), workout: {} })), chunk: jest.fn() };
  const headers: Record<string, string> = { origin: 'https://example.invalid', authorization: 'Bearer ' + 'a'.repeat(43) };
  const req: any = { method: 'POST', path: '/guest-workout-api/manifest', query: {}, body: {}, get: (k: string) => headers[k], is: () => true };
  const res: any = { set: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
  return { service, req, res, headers };
}
test('HTTP draft defaults closed without touching capability or media storage', async () => {
  const f = fixture(); await guestDeliveryHttp(f.service, f.headers.origin)(f.req, f.res);
  expect(f.res.status).toHaveBeenCalledWith(404); expect(f.service.manifest).not.toHaveBeenCalled();
});
test.each(['origin', 'query', 'method', 'token', 'body'])('rejects invalid boundary %s with uniform error', async kind => {
  const f = fixture();
  if (kind === 'origin') f.headers.origin = 'https://other.invalid';
  if (kind === 'query') f.req.query = { token: 'synthetic' };
  if (kind === 'method') f.req.method = 'GET';
  if (kind === 'token') f.headers.authorization = 'bad';
  if (kind === 'body') f.req.body = { token: 'synthetic' };
  await guestDeliveryHttp(f.service, 'https://example.invalid', true)(f.req, f.res);
  expect(f.res.json).toHaveBeenCalledWith({ error: 'Workout unavailable.' }); expect(f.service.manifest).not.toHaveBeenCalled();
});
test('valid internal fixture only returns projection with private no-store headers', async () => {
  const f = fixture(); await guestDeliveryHttp(f.service, f.headers.origin, true)(f.req, f.res);
  expect(f.service.manifest).toHaveBeenCalledWith('a'.repeat(43)); expect(f.res.status).toHaveBeenCalledWith(200);
  expect(f.res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': expect.stringContaining('no-store') }));
});
test('oversized body is rejected before data access', async () => {
  const f = fixture(); f.req.body = { padding: 'x'.repeat(1025) };
  await guestDeliveryHttp(f.service, f.headers.origin, true)(f.req, f.res);
  expect(f.res.status).toHaveBeenCalledWith(404); expect(f.service.manifest).not.toHaveBeenCalled();
});
