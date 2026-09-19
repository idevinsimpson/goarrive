import { describe, expect, it } from 'vitest';

import { buildCombinedUrl, combinedRoute } from '../src/ui/combinedLink';

/**
 * The combined screen's address. A mirror of `kiosk-link.test.ts`, plus the
 * one assertion this feature owes the owner: the setup URL carries NO
 * participant token and no administrative authority. A token would have to
 * live in a query string or a fragment, so the test pins that the built
 * address has neither.
 */
describe('buildCombinedUrl', () => {
  it('builds the address the combined screen opens on', () => {
    expect(buildCombinedUrl({ origin: 'https://example.web.app', setupId: 'setup-1' })).toBe(
      'https://example.web.app/combined/setup-1'
    );
  });

  it('does not double the slash when the origin carries one', () => {
    expect(buildCombinedUrl({ origin: 'https://example.web.app/', setupId: 'setup-1' })).toBe(
      'https://example.web.app/combined/setup-1'
    );
    expect(buildCombinedUrl({ origin: 'https://example.web.app///', setupId: 'setup-1' })).toBe(
      'https://example.web.app/combined/setup-1'
    );
  });

  // A link is either correct or absent. A half-built one would be copied,
  // opened on a screen at an event, and fail there rather than here.
  it('returns nothing rather than a broken link', () => {
    expect(buildCombinedUrl({ origin: null, setupId: 'setup-1' })).toBeNull();
    expect(buildCombinedUrl({ origin: undefined, setupId: 'setup-1' })).toBeNull();
    expect(buildCombinedUrl({ origin: '', setupId: 'setup-1' })).toBeNull();
    expect(buildCombinedUrl({ origin: 'https://example.web.app', setupId: null })).toBeNull();
    expect(buildCombinedUrl({ origin: 'https://example.web.app', setupId: undefined })).toBeNull();
    expect(buildCombinedUrl({ origin: 'https://example.web.app', setupId: '   ' })).toBeNull();
  });

  it('escapes an id so the path cannot be steered by it', () => {
    expect(buildCombinedUrl({ origin: 'https://example.web.app', setupId: 'a/../b' })).toBe(
      'https://example.web.app/combined/a%2F..%2Fb'
    );
    expect(combinedRoute('a?b#c')).toBe('/combined/a%3Fb%23c');
  });

  // THE URL CARRIES NOTHING. It is a document name, not a capability: no
  // query string and no fragment, which are the only two places a token could
  // ride. Every read re-evaluates the server-side gate on its own merits.
  it('carries no token: no query string and no fragment', () => {
    const url = buildCombinedUrl({
      origin: 'https://example.web.app',
      setupId: 'AbC123_-xyz',
    });
    expect(url).toBe('https://example.web.app/combined/AbC123_-xyz');
    expect(url).not.toContain('?');
    expect(url).not.toContain('#');
    expect(url).not.toContain('token');
  });

  it('is a top-level segment, not nested under the single-goal kiosk', () => {
    // `/kiosk/**` already rewrites to the single-goal kiosk page, so a nested
    // route would be served by it and would export an alias path the build
    // refuses. The segment being disjoint is the whole reason it is top level.
    expect(combinedRoute('setup-1').startsWith('/combined/')).toBe(true);
    expect(combinedRoute('setup-1')).not.toContain('/kiosk/');
  });
});
