import { prepareMemberInvite } from '../memberInvite';
function fixture() {
  let user: any;
  const auth: any = {
    getUserByEmail: jest.fn(async () => { if (!user) throw { code: 'auth/user-not-found' }; return user; }),
    createUser: jest.fn(async () => (user = { uid: 'auth-member', customClaims: {} })),
    generatePasswordResetLink: jest.fn(async () => 'synthetic-reset-link'),
    setCustomUserClaims: jest.fn(async (_uid, claims) => { user.customClaims = claims; }),
  };
  const link = jest.fn(async () => {});
  const run = () => prepareMemberInvite(auth, 'roster', { email: 'synthetic@example.test', coachId: 'coach' }, 'https://example.test', link);
  return { auth, link, run };
}
test('reset-link failure leaves membership and claims untouched; retry reuses account', async () => {
  const f = fixture();
  f.auth.generatePasswordResetLink.mockRejectedValueOnce(new Error('synthetic failure'));
  await expect(f.run()).rejects.toThrow('synthetic failure');
  expect(f.auth.setCustomUserClaims).not.toHaveBeenCalled(); expect(f.link).not.toHaveBeenCalled();
  await expect(f.run()).resolves.toMatchObject({ success: true });
  expect(f.auth.createUser).toHaveBeenCalledTimes(1);
});
test.each(['claims', 'link'])('retry recovers a partial %s failure without duplicate accounts', async stage => {
  const f = fixture();
  (stage === 'claims' ? f.auth.setCustomUserClaims : f.link).mockRejectedValueOnce(new Error('synthetic failure'));
  await expect(f.run()).rejects.toThrow();
  await expect(f.run()).resolves.toMatchObject({ success: true });
  expect(f.auth.createUser).toHaveBeenCalledTimes(1);
  expect(f.link).toHaveBeenLastCalledWith('auth-member', 'synthetic@example.test');
});
test('existing coach account is never downgraded to member', async () => {
  const f = fixture();
  f.auth.getUserByEmail.mockResolvedValue({ uid: 'coach', customClaims: { role: 'coach' } });
  await expect(f.run()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(f.auth.setCustomUserClaims).not.toHaveBeenCalled(); expect(f.link).not.toHaveBeenCalled();
});
