import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEV_TUNNEL_DOMAINS, isShareableHttpsUrl, shareControlLabel, shareRoute } from '../src/shareGoalDisplay';
import {
  canAttemptCopy,
  copyLink,
  hasShareSheet,
  linkShareRoute,
  offerableLink,
  offersCopy,
  shareLinkSheet,
} from '../src/ui/shareLink';

/**
 * NATIVE-MEMBER-1 F-3 (MF-01): the web's half of the copy and share helper is
 * exactly what the six call sites did inline before; the display route gains
 * `nativeShare` for React Native's navigator; and the call sites all go
 * through the helper. The app's half is share-link-native.test.ts.
 */

const RN_NAVIGATOR = { product: 'ReactNative' };

/** Runs `run` with EXPO_PUBLIC_WSF_INVITE_HOSTS set to `value` (undefined: unset), then restores it. */
function withInviteHosts<T>(value: string | undefined, run: () => T): T {
  const saved = process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
  if (value === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
  else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = value;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = saved;
  }
}

describe("shareRoute: React Native's navigator (MF-01 case 4)", () => {
  it('is nativeShare once the origin is a configured canonical host', () => {
    withInviteHosts('westayfit.app', () => expect(shareRoute(RN_NAVIGATOR, 'https://westayfit.app')).toBe('nativeShare'));
  });
  it('NB-A: with no canonical host configured it is unavailable, fail closed', () => {
    withInviteHosts(undefined, () => expect(shareRoute(RN_NAVIGATOR, 'https://westayfit.app')).toBe('unavailable'));
  });
  it('is unavailable with no origin (release, INT-08) or the Metro origin (dev, case 5)', () => {
    expect(shareRoute(RN_NAVIGATOR, null)).toBe('unavailable');
    expect(shareRoute(RN_NAVIGATOR, 'http://192.168.1.20:8081')).toBe('unavailable');
    expect(shareRoute(RN_NAVIGATOR, 'https://192.168.1.20:8081')).toBe('unavailable');
  });
  it('a browser navigator is decided exactly as before, whatever the origin', () => {
    expect(shareRoute({ share: () => Promise.resolve() }, null)).toBe('webShare');
    expect(shareRoute({ clipboard: { writeText: () => {} } }, null)).toBe('clipboard');
    expect(shareRoute({}, 'https://westayfit.app')).toBe('unavailable');
  });
  it('the native route is labelled Share, like the Web Share route', () => {
    expect(shareControlLabel('nativeShare', 'idle')).toBe('Share');
    expect(shareControlLabel('nativeShare', 'failed')).toBe('Share');
  });
  it('isShareableHttpsUrl', () => {
    withInviteHosts('westayfit.app host', () => {
      expect(isShareableHttpsUrl('https://westayfit.app')).toBe(true);
      expect(isShareableHttpsUrl('https://westayfit.app/display/goal%201')).toBe(true);
      for (const bad of ['http://westayfit.app', 'https://westayfit.app:443/x', 'https://a@westayfit.app/x', 'https://', 'https://westayfit.app./x', ' https://westayfit.app', 'ftp://westayfit.app', 'https://host/x', null, 7]) {
        expect(isShareableHttpsUrl(bad)).toBe(false);
      }
    });
  });
});

describe('the web helper does what the call sites did inline', () => {
  const nav = window.navigator as unknown as Record<string, unknown>;
  afterEach(() => {
    delete nav.share;
    delete nav.clipboard;
  });

  it('copyLink: writeText, copied on success, failed on rejection or no clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyLink('https://x.test/join/a')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.test/join/a');
    writeText.mockRejectedValueOnce(new Error('denied'));
    expect(await copyLink('https://x.test/join/a')).toBe('failed');
    delete nav.clipboard;
    expect(await copyLink('https://x.test/join/a')).toBe('failed');
  });

  it('shareLinkSheet: navigator.share with {title, url} or {url}; dismissal is quiet; no API, no call', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(nav, 'share', { value: shareFn, configurable: true });
    expect(hasShareSheet()).toBe(true);
    await shareLinkSheet({ title: 'Join our We Stay Fit community', url: 'https://x.test/join/a' });
    expect(shareFn).toHaveBeenLastCalledWith({ title: 'Join our We Stay Fit community', url: 'https://x.test/join/a' });
    await shareLinkSheet({ url: 'https://x.test/display/g' });
    expect(shareFn).toHaveBeenLastCalledWith({ url: 'https://x.test/display/g' });
    shareFn.mockRejectedValueOnce(new Error('AbortError'));
    await expect(shareLinkSheet({ url: 'https://x.test/display/g' })).resolves.toBeUndefined();
    delete nav.share;
    expect(hasShareSheet()).toBe(false);
    await shareLinkSheet({ url: 'https://x.test/display/g' });
    expect(shareFn).toHaveBeenCalledTimes(3);
  });

  it('offers any link the web built, as before (http included)', () => {
    expect(offerableLink('http://localhost:8081/join/a')).toBe(true);
    expect(offerableLink('')).toBe(false);
    expect(offerableLink(null)).toBe(false);
    expect(canAttemptCopy()).toBe(true);
  });

  it('linkShareRoute reads the live navigator', () => {
    Object.defineProperty(nav, 'share', { value: () => Promise.resolve(), configurable: true });
    expect(linkShareRoute()).toBe('webShare');
    delete nav.share;
    Object.defineProperty(nav, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    expect(linkShareRoute()).toBe('clipboard');
  });
});

describe('every copy and share call site goes through the helper (MF-01 wiring)', () => {
  const src = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/community/[groupId]/index.tsx'), 'utf8');
  const body = (name: string) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start, name).toBeGreaterThan(0);
    // Up to the callback's own dependency list: `}, [` (possibly across a line break).
    const m = /\},\s*\[/.exec(src.slice(start));
    expect(m, name).not.toBeNull();
    return src.slice(start, start + m!.index);
  };

  it('no call site touches navigator.clipboard or navigator.share any more', () => {
    expect(src).not.toMatch(/navigator\.clipboard|navigator as Navigator|\.share\(\{/);
  });

  it.each(['onCopyInvite', 'onCopyKiosk', 'onCopyStation', 'onCopyCombined'])('%s copies through copyLink, gated on offerableLink', (name) => {
    const b = body(name);
    expect(b).toContain('offerableLink(');
    expect(b).toContain('await copyLink(');
  });

  it('onShareInvite shares through shareLinkSheet, gated on offerableLink', () => {
    const b = body('onShareInvite');
    expect(b).toContain('if (!offerableLink(inviteUrl)) return;');
    expect(b).toContain("shareLinkSheet({ title: 'Join our We Stay Fit community', url: inviteUrl })");
  });

  it('onShareGoalDisplay takes its route from the helper and shares natively or on the web', () => {
    const b = body('onShareGoalDisplay');
    expect(b).toContain('const route = linkShareRoute();');
    expect(b).toContain("route === 'webShare' || route === 'nativeShare'");
    expect(b).toContain('await shareLinkSheet({ url })');
    expect(b).toContain('await copyLink(url)');
  });

  it('Share invite derives from the helper, and every Copy/QR branch asks offerableLink', () => {
    expect(src).toContain('const hasShareApi = hasShareSheet();');
    expect(src).toContain('const showInviteCard = isChampion || (linkJoinable && offerableLink(inviteUrl));');
    for (const gate of [
      'offerableLink(inviteUrl) ? (\n                  <JoinQrCode url={inviteUrl} caveat={MANAGE_QR_CAVEAT} />',
      '{offerableLink(kioskUrlFor(goal.goalId)) && (LINK_COPY.offersOpenKiosk || offersCopy()) ? (',
      '{offerableLink(stationUrlFor(goal.goalId)) && offersCopy() ? (',
      '{offerableLink(stationUrlFor(goal.goalId)) ? null : (',
      '{offerableLink(combinedUrl) && offersCopy() ? (',
      '{offerableLink(combinedUrl) ? null : (',
    ]) {
      expect(src, gate).toContain(gate);
    }
    // The member-facing Invite card's controls sit inside the offerable branch.
    const card = src.indexOf('testID="wsf-community-invite"');
    const branch = src.indexOf('offerableLink(inviteUrl) ? (', card);
    expect(branch).toBeGreaterThan(card);
    expect(src.indexOf('testID="wsf-community-invite-copy"', card)).toBeGreaterThan(branch);
  });

  // F3-N1: in the app Copy is drawn only when expo-clipboard's native module
  // is present. Each Copy control sits directly behind offersCopy().
  it.each([
    ['wsf-community-invite-copy', 'testID="wsf-community-invite-copy"'],
    ['wsf-kiosk-setup-copy', 'testID={`wsf-kiosk-setup-copy-${goal.goalId}`}'],
    ['wsf-kiosk-stations-copy', 'testID={`wsf-kiosk-stations-copy-${goal.goalId}`}'],
    ['wsf-combined-copy', 'testID="wsf-combined-copy"'],
  ])('%s is drawn only when offersCopy()', (_l, testId) => {
    const at = src.indexOf(testId);
    expect(at, testId).toBeGreaterThan(0);
    const pressable = src.lastIndexOf('<Pressable', at);
    const gate = src.lastIndexOf('offersCopy()', pressable);
    expect(gate, `${testId} gate`).toBeGreaterThan(0);
    // Nothing else opens between the gate and this control.
    expect(src.slice(gate, pressable)).toMatch(/^offersCopy\(\) \? \(\s*$/);
  });

  it('the web helper always offers Copy, so the web draws exactly what it did', () => {
    expect(offersCopy()).toBe(true);
  });
});

describe('F3-N2: a development tunnel is never a shareable origin', () => {
  const saved = process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = saved;
  });

  it.each([
    ['expo start --tunnel', 'https://abc123-anonymous-8081.exp.direct'],
    ['a tunnel link with a path', 'https://abc123-8081.exp.direct/join/Ab3_dE-fGh1JkLmN0pQrSt'],
    ['exp.direct itself', 'https://exp.direct'],
    ['upper case', 'https://ABC-8081.EXP.DIRECT'],
    ['exp.host', 'https://exp.host/@someone/app'],
    ['ngrok.io', 'https://1a2b3c.ngrok.io'],
    ['ngrok-free.app', 'https://1a2b-203-0-113-7.ngrok-free.app'],
    ['ngrok.app', 'https://x.ngrok.app'],
    ['ngrok-free.dev', 'https://x.ngrok-free.dev'],
    ['ngrok.dev', 'https://x.ngrok.dev'],
  ])('%s is refused with nothing configured', (_l, url) => {
    delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    expect(isShareableHttpsUrl(url)).toBe(false);
    expect(shareRoute({ product: 'ReactNative' }, url)).toBe('unavailable');
  });

  it('a development forwarder is never a canonical host, and only whole labels count', () => {
    for (const d of DEV_TUNNEL_DOMAINS) {
      process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = `x.${d}`;
      expect(isShareableHttpsUrl(`https://x.${d}`), d).toBe(false);
    }
    // A host that merely ends in the same letters is not a forwarder.
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'notexp.direct.example, myexp.direct';
    expect(isShareableHttpsUrl('https://notexp.direct.example')).toBe(true);
    expect(isShareableHttpsUrl('https://myexp.direct')).toBe(true);
  });

  it('once the canonical hosts are configured, only those hosts are shareable, exactly', () => {
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'westayfit.app, staging.westayfit.app';
    expect(isShareableHttpsUrl('https://westayfit.app/join/Ab3_dE-fGh1JkLmN0pQrSt')).toBe(true);
    expect(isShareableHttpsUrl('https://STAGING.westayfit.app/kiosk/g1')).toBe(true);
    for (const url of [
      'https://evil.example/join/x',
      'https://a.westayfit.app/join/x',
      'https://westayfit.app.evil.example/',
      'https://abc-8081.exp.direct',
    ]) {
      expect(isShareableHttpsUrl(url), url).toBe(false);
    }
    expect(shareRoute({ product: 'ReactNative' }, 'https://westayfit.app')).toBe('nativeShare');
    expect(shareRoute({ product: 'ReactNative' }, 'https://goarrive.web.app')).toBe('unavailable');
  });

  it.each([
    ['a scheme', 'https://westayfit.app'],
    ['a port', 'westayfit.app:443'],
    ['a trailing dot', 'westayfit.app.'],
    ['a wildcard', '*.westayfit.app'],
    ['.internal', 'westayfit.internal'],
    ['a development forwarder', 'abc-8081.exp.direct'],
    ['several, every one ignored', 'https://westayfit.app, westayfit.app:443 *.westayfit.app'],
  ])('NB-B: a value with only %s is configured-but-empty: nothing is shareable', (_l, value) => {
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = value;
    expect(isShareableHttpsUrl('https://westayfit.app')).toBe(false);
    expect(isShareableHttpsUrl('https://abc-8081.exp.direct')).toBe(false);
    expect(shareRoute(RN_NAVIGATOR, 'https://westayfit.app')).toBe('unavailable');
  });

  it('NB-B: a usable entry beside ignored ones is kept', () => {
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'https://westayfit.app, westayfit.app:443, staging.westayfit.app';
    expect(isShareableHttpsUrl('https://staging.westayfit.app')).toBe(true);
    expect(isShareableHttpsUrl('https://westayfit.app')).toBe(false);
  });
});

describe('NB-1, NB-A: a non-public or forwarding host is never shareable, configured or not', () => {
  const saved = process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = saved;
  });

  it.each([
    ['localhost', 'https://localhost/join/x'],
    ['another single label', 'https://intranet/join/x'],
    ['the Android emulator host', 'https://10.0.2.2/join/x'],
    ['a LAN address', 'https://192.168.1.20/join/x'],
    ['loopback', 'https://127.0.0.1'],
    ['a public IPv4 literal', 'https://203.0.113.7/join/x'],
    ['an mDNS name', 'https://my-laptop.local/join/x'],
    ['under localhost', 'https://app.localhost'],
    ['.internal', 'https://wsf.internal'],
    ['home.arpa', 'https://nas.home.arpa'],
    ['home.arpa itself (NB-C)', 'https://home.arpa'],
    ['localtest.me (NB-A)', 'https://app.localtest.me'],
    ['localtest.me itself (NB-A)', 'https://localtest.me'],
    ['lvh.me (NB-A)', 'https://app.lvh.me'],
    ['localhost.localdomain (NB-A)', 'https://localhost.localdomain'],
    ['a router .lan name (NB-A)', 'https://nas.lan'],
    ['a router .home name (NB-A)', 'https://router.home'],
    ['fritz.box (NB-A)', 'https://fritz.box'],
    ['Microsoft dev tunnels (NB-A)', 'https://abc-8081.euw.devtunnels.ms/join/x'],
    ['GitHub Codespaces (NB-A)', 'https://fuzzy-space-8081.app.github.dev'],
    ['Tailscale (NB-A)', 'https://laptop.tail1234.ts.net'],
    ['Pinggy (NB-A)', 'https://abc.a.pinggy.link'],
    ['a Cloudflare quick tunnel', 'https://plain-words-here.trycloudflare.com'],
    ['localtunnel', 'https://tidy-cat-12.loca.lt'],
    ['localtunnel.me', 'https://x.localtunnel.me'],
    ['localhost.run', 'https://abc123.lhr.life'],
    ['localhost.run itself', 'https://x.localhost.run'],
    ['serveo', 'https://x.serveo.net'],
    ['nip.io naming the emulator host', 'https://10.0.2.2.nip.io/join/x'],
    ['sslip.io', 'https://192-168-1-20.sslip.io'],
  ])('%s is refused with nothing configured, and even when configured as itself', (_l, url) => {
    const host = url.slice('https://'.length).split('/')[0]!;
    const origin = `https://${host}`;
    delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    expect(isShareableHttpsUrl(url)).toBe(false);
    expect(shareRoute({ product: 'ReactNative' }, origin)).toBe('unavailable');
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = host;
    expect(isShareableHttpsUrl(url)).toBe(false);
    expect(shareRoute({ product: 'ReactNative' }, origin)).toBe('unavailable');
  });

  it('NB-A: with nothing configured not even a public host is shareable (fail closed)', () => {
    for (const value of [undefined, '', '  ', ' , ,']) {
      if (value === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
      else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = value;
      expect(isShareableHttpsUrl('https://westayfit.app/join/x'), String(value)).toBe(false);
      expect(isShareableHttpsUrl('https://goarrive.web.app'), String(value)).toBe(false);
      expect(shareRoute({ product: 'ReactNative' }, 'https://westayfit.app'), String(value)).toBe('unavailable');
    }
  });

  it('a configured value cannot make a non-public host shareable', () => {
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'localhost, 10.0.2.2, my-laptop.local, wsf.internal';
    for (const url of ['https://localhost', 'https://10.0.2.2', 'https://my-laptop.local', 'https://wsf.internal']) {
      expect(isShareableHttpsUrl(url), url).toBe(false);
    }
  });
});
