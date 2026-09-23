import { firestoreWrite, stampId, tsField } from './helpers/mobile';

/**
 * THE SHARED SOCIAL FIXTURE, used by BOTH the AFTER capture and the privacy
 * guard.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. The guard asserts that the first
 * momentum row is inside the initial viewport; the capture is the picture a
 * reviewer judges. If the two seed differently, the guard measures a page
 * nobody ever sees and reports safety for one the reviewer will reject — which
 * is exactly what happened when the guard's community had one fewer member, no
 * second community and no moved-today line, passed, and the capture came back
 * with the card below the fold.
 *
 * Not a `.spec.ts`, so Playwright's testMatch does not collect it as a suite.
 */

/** The timezone `seedActiveGoal` writes onto a goal. */
export const GOAL_TZ = 'America/New_York';

/**
 * The instant the current local day began in a zone.
 *
 * THE FIXTURE MUST SEED INSIDE THE GOAL'S OWN DAY, not the runner's. The
 * container runs in UTC and the goal's zone is New York, so a run between 04:00
 * and 05:00 UTC puts "55 minutes ago" into YESTERDAY in New York: the count
 * comes back 0 and the evidence shows the feature not firing while the code is
 * perfectly correct. A recapture at 04:39 UTC did precisely that.
 */
export function zonedDayStartMs(timeZone: string, nowMs = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string): number => Number(parts.find((x) => x.type === t)!.value);
  const hour = get('hour') === 24 ? 0 : get('hour');
  const offset =
    Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second')) -
    nowMs;
  const wall = new Date(nowMs + offset);
  return Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - offset;
}

/**
 * A membership carrying an EXPLICIT privacy choice.
 *
 * Written with the same field names and literal values
 * `wsfSetCommunityVisibility` writes, because a fixture in any other shape
 * would be evidence of a screen reading data the product never produces. A
 * membership seeded WITHOUT either field is the real state of every row in the
 * product today, and is what the owner's visible-by-default rule governs.
 */
export async function seedMembershipWithVisibility(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  vis: { name?: 'visible' | 'private'; activity?: 'visible' | 'private' },
): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (vis.name) fields.communityNameVisibility = { stringValue: vis.name };
  if (vis.activity) fields.communityActivityVisibility = { stringValue: vis.activity };
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, fields as never);
}

/**
 * A contribution, written exactly the way `wsfContribute` writes one, and
 * clamped into the goal's current local day.
 */
export async function seedContribution(
  groupId: string,
  goalId: string,
  uid: string,
  count: number,
  minutesAgo: number,
): Promise<void> {
  const attemptId = stampId();
  const dayStart = zonedDayStartMs(GOAL_TZ);
  const at = new Date(Math.max(Date.now() - minutesAgo * 60_000, dayStart + 60_000));
  await firestoreWrite(`wsfContributions/${goalId}_${uid}_${attemptId}`, {
    goalId: { stringValue: goalId },
    attemptId: { stringValue: attemptId },
    userId: { stringValue: uid },
    count: { integerValue: String(count) },
    shardIndex: { integerValue: '0' },
    unit: { stringValue: 'squats' },
    communityGroupId: { stringValue: groupId },
    crossedTarget: { booleanValue: false },
    createdAt: tsField(at),
  } as never);
}
