import { sessionMemberIds } from '../../../apps/goarrive/lib/sessionMemberIds';
import { isTemplateCandidate, subscriptionPathOptions } from '../../../apps/goarrive/lib/playbookTemplates';
test('detached and unassigned copies remain ineligible as template sources', () => {
  expect(isTemplateCandidate({ templateSourceId: 'original', assignedMemberId: null })).toBe(false);
  expect(isTemplateCandidate({ templateSourceId: 'original', syncEnabled: false })).toBe(false);
  expect(isTemplateCandidate({ name: 'Original template' })).toBe(true);
});
test('blank optional subscription inputs omit Firestore-invalid undefined fields', () => {
  expect(subscriptionPathOptions('', undefined)).toEqual({});
  expect(subscriptionPathOptions('calm', 1500)).toEqual({ musicStyle: 'calm', pricePerMonthCents: 1500 });
});

test('session identity query includes both historical and roster IDs without duplicates', () => {
  expect(sessionMemberIds('auth', 'roster')).toEqual(['auth', 'roster']);
  expect(sessionMemberIds('auth', 'auth')).toEqual(['auth']);
});
