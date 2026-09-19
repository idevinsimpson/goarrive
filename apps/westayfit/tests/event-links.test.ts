/**
 * The addresses an event uses.
 *
 * The point of most of these cases is the standing quality bar: no secret, no
 * token and no administrative authority may ever ride in a URL or a QR code.
 * These builders are where that is decided, so this is where it is pinned.
 */
import { describe, expect, it } from 'vitest';

import {
  buildEventJoinUrlFromScreenedCode,
  buildEventUrl,
  buildJoinEventUrl,
  buildStationUrl,
  eventRoute,
  readEventParam,
  stationRoute,
} from '../src/ui/eventLinks';

const ORIGIN = 'https://westayfit-app.web.app';

describe('the routes', () => {
  it('are the two the Hosting rewrites already resolve', () => {
    expect(stationRoute('goal_1')).toBe('/station/goal_1');
    expect(eventRoute('goal_1')).toBe('/event/goal_1');
  });

  it('escape an id so the path cannot be steered by it', () => {
    expect(stationRoute('a/../b')).toBe('/station/a%2F..%2Fb');
    expect(eventRoute('a/../b')).toBe('/event/a%2F..%2Fb');
  });
});

describe('the station address the Champion opens or copies', () => {
  it('is the origin this build is served from, plus the goal', () => {
    expect(buildStationUrl({ origin: ORIGIN, goalId: 'goal_1' })).toBe(
      'https://westayfit-app.web.app/station/goal_1'
    );
    expect(buildStationUrl({ origin: `${ORIGIN}///`, goalId: 'goal_1' })).toBe(
      'https://westayfit-app.web.app/station/goal_1'
    );
  });

  it('is either correct or absent', () => {
    expect(buildStationUrl({ origin: null, goalId: 'goal_1' })).toBeNull();
    expect(buildStationUrl({ origin: ORIGIN, goalId: '  ' })).toBeNull();
    expect(buildStationUrl({ origin: ORIGIN, goalId: null })).toBeNull();
  });

  /**
   * THE WHOLE POINT OF THE ENROLMENT DESIGN. The address a Champion copies
   * onto a screen carries a goal id and nothing else. A device that opens it
   * is not enrolled by opening it: it has to show a code and wait to be
   * approved. Nothing here takes a secret, so nothing here can leak one.
   */
  it('carries a goal id and nothing else — no query, no fragment, no credential', () => {
    const url = buildStationUrl({ origin: ORIGIN, goalId: 'goal_1' })!;
    expect(url).not.toContain('?');
    expect(url).not.toContain('#');
    expect(new URL(url).pathname).toBe('/station/goal_1');
  });
});

describe('the member address on the screen', () => {
  it('is the event page for this goal', () => {
    expect(buildEventUrl({ origin: ORIGIN, goalId: 'goal_1' })).toBe(
      'https://westayfit-app.web.app/event/goal_1'
    );
    expect(buildEventUrl({ origin: undefined, goalId: 'goal_1' })).toBeNull();
    expect(buildEventUrl({ origin: ORIGIN, goalId: '' })).toBeNull();
  });

  it('carries no query string at all, so it can carry no token', () => {
    expect(buildEventUrl({ origin: ORIGIN, goalId: 'goal_1' })).not.toContain('?');
  });
});

describe('the newcomer address on the screen', () => {
  const CODE = 'vT6nQpR2s8XyZ0aBcDeFgH';

  it('is the existing join link with the event named on it', () => {
    expect(
      buildJoinEventUrl({ origin: ORIGIN, joinCode: CODE, joinPolicy: 'public', goalId: 'goal_1' })
    ).toBe(`https://westayfit-app.web.app/join/${CODE}?event=goal_1`);
    expect(
      buildJoinEventUrl({
        origin: ORIGIN,
        joinCode: CODE,
        joinPolicy: 'inviteOnly',
        goalId: 'goal_1',
      })
    ).toBe(`https://westayfit-app.web.app/join/${CODE}?event=goal_1`);
  });

  /**
   * ADMISSION POLICY IS NOT THIS FEATURE'S TO CHANGE. A private community
   * admits nobody by link, so there is no link — the same answer buildJoinUrl
   * gives, because this delegates to it rather than deciding again. A screen
   * standing in the room changes nothing about who may be admitted.
   */
  it('does not exist for a community that admits nobody by link', () => {
    expect(
      buildJoinEventUrl({ origin: ORIGIN, joinCode: CODE, joinPolicy: 'private', goalId: 'goal_1' })
    ).toBeNull();
    expect(
      buildJoinEventUrl({ origin: ORIGIN, joinCode: CODE, joinPolicy: null, goalId: 'goal_1' })
    ).toBeNull();
    expect(
      buildJoinEventUrl({ origin: ORIGIN, joinCode: null, joinPolicy: 'public', goalId: 'goal_1' })
    ).toBeNull();
  });

  // The screen at an event cannot read a community document, so the server
  // screens the policy and hands it a code only when a link admits at all.
  // The presence of the code IS the decision, and this builder says so.
  it('builds the same string from a code the server already screened', () => {
    expect(
      buildEventJoinUrlFromScreenedCode({ origin: ORIGIN, joinCode: CODE, goalId: 'goal_1' })
    ).toBe(`https://westayfit-app.web.app/join/${CODE}?event=goal_1`);
    expect(
      buildEventJoinUrlFromScreenedCode({ origin: ORIGIN, joinCode: null, goalId: 'goal_1' })
    ).toBeNull();
    expect(
      buildEventJoinUrlFromScreenedCode({ origin: null, joinCode: CODE, goalId: 'goal_1' })
    ).toBeNull();
  });

  it('carries the join code and the goal, and nothing a scanner could be given authority by', () => {
    const url = buildEventJoinUrlFromScreenedCode({
      origin: ORIGIN,
      joinCode: CODE,
      goalId: 'goal_1',
    })!;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/join/${CODE}`);
    expect([...parsed.searchParams.keys()]).toEqual(['event']);
    expect(parsed.searchParams.get('event')).toBe('goal_1');
    expect(parsed.hash).toBe('');
  });

  it('escapes the event id rather than letting it add parameters of its own', () => {
    const url = buildEventJoinUrlFromScreenedCode({
      origin: ORIGIN,
      joinCode: CODE,
      goalId: 'goal_1&admin=1',
    })!;
    const parsed = new URL(url);
    expect([...parsed.searchParams.keys()]).toEqual(['event']);
    expect(parsed.searchParams.get('event')).toBe('goal_1&admin=1');
  });
});

describe('the ?event parameter a join honours', () => {
  it('accepts a goal id and refuses anything that could become a path', () => {
    expect(readEventParam('goal_1')).toBe('goal_1');
    expect(readEventParam('  goal_1 ')).toBe('goal_1');
    expect(readEventParam('a/../b')).toBeNull();
    expect(readEventParam('')).toBeNull();
    expect(readEventParam(undefined)).toBeNull();
    expect(readEventParam(['goal_1'])).toBeNull();
  });
});
