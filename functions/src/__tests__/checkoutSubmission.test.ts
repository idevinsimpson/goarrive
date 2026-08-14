import { projectCheckoutSubmission } from '../checkoutSubmission';

describe('projectCheckoutSubmission', () => {
  test('returns exactly the four non-PII fields required by checkout', () => {
    const projection = projectCheckoutSubmission({
      coachId: 'coach-123',
      programName: 'Strength Foundations',
      folderId: 'folder-456',
      subscriptionPathId: 'path-789',
      status: 'pending_checkout',
      firstName: 'Private',
      email: 'private@example.com',
      questionnaireAnswers: { goal: 'private answer' },
    });

    expect(projection).toEqual({
      coachId: 'coach-123',
      programName: 'Strength Foundations',
      folderId: 'folder-456',
      subscriptionPathId: 'path-789',
    });
    expect(Object.keys(projection)).toEqual([
      'coachId',
      'programName',
      'folderId',
      'subscriptionPathId',
    ]);
    expect(projection).not.toHaveProperty('status');
    expect(projection).not.toHaveProperty('firstName');
    expect(projection).not.toHaveProperty('email');
    expect(projection).not.toHaveProperty('questionnaireAnswers');
  });

  test('normalizes missing or non-string optional fields without copying input', () => {
    expect(projectCheckoutSubmission({ coachId: 123, email: 'private@example.com' })).toEqual({
      coachId: '',
      programName: null,
      folderId: null,
      subscriptionPathId: null,
    });
  });
});
