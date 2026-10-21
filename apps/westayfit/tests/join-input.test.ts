import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  configuredInviteHosts,
  inviteOrigins,
  inviteOriginsFor,
  isDevTunnelHost,
  isPublicHost,
  JOIN_INPUT_MAX,
  parseJoinInput,
} from '../src/joinInput';
import { readActivityLabel } from '../src/eventActivity';
import { readEventParam } from '../src/ui/eventLinks';

/**
 * NATIVE-MEMBER-1 F-2 (MF-02): Home's "Join with a code" field reads a bare
 * code or the invite link members are given, and nothing else. Cases 1-4 of
 * MF-02, then hostile input, then our origins (review N3): an http(s) link is
 * read only from a configured invite host or, on the web, the page's own
 * origin.
 */

// The server mints 22-character base64url codes.
const CODE = 'Ab3_dE-fGh1JkLmN0pQrSt';
/** The origins most cases are read against: production and staging, as INT-08 may configure them. */
const OURS = ['https://westayfit.app', 'https://westayfit-staging.web.app'];
const parse = (raw: unknown) => parseJoinInput(raw, OURS);
const href = (raw: unknown) => parse(raw)?.href ?? null;

describe('MF-02 case 1: the https invite link opens the join preview for its code', () => {
  it('reads https://<host>/join/<code>', () => {
    expect(parse(`https://westayfit.app/join/${CODE}`)).toEqual({ code: CODE, href: `/join/${CODE}` });
    expect(href(`https://westayfit-staging.web.app/join/${CODE}`)).toBe(`/join/${CODE}`);
  });
  it('still reads a bare code exactly as before', () => {
    expect(href(CODE)).toBe(`/join/${CODE}`);
    // The e2e floor: 16 characters.
    expect(href('a1b2c3d4e5f6g7h8')).toBe('/join/a1b2c3d4e5f6g7h8');
    expect(href('x'.repeat(128))).toBe(`/join/${'x'.repeat(128)}`);
  });
  it('accepts any scheme or host case for our origin', () => {
    expect(href(`HTTPS://WestayFit.App/join/${CODE}`)).toBe(`/join/${CODE}`);
    expect(href(`https://WESTAYFIT-STAGING.WEB.APP/join/${CODE}`)).toBe(`/join/${CODE}`);
  });
  it('accepts http, a port and an IP literal only when that exact origin is ours (a web dev server)', () => {
    const dev = ['http://localhost:8081', 'http://192.168.1.20:8081', 'http://[::1]:8081'];
    expect(parseJoinInput(`http://localhost:8081/join/${CODE}`, dev)?.href).toBe(`/join/${CODE}`);
    expect(parseJoinInput(`http://192.168.1.20:8081/join/${CODE}`, dev)?.href).toBe(`/join/${CODE}`);
    expect(parseJoinInput(`http://[::1]:8081/join/${CODE}`, dev)?.href).toBe(`/join/${CODE}`);
  });
});

describe('MF-02 case 2: trailing slash, surrounding whitespace, the app scheme', () => {
  it('allows one trailing slash', () => {
    expect(href(`https://westayfit.app/join/${CODE}/`)).toBe(`/join/${CODE}`);
  });
  it('trims surrounding whitespace, including newlines from a paste', () => {
    expect(href(`  https://westayfit.app/join/${CODE}  `)).toBe(`/join/${CODE}`);
    expect(href(`\n\thttps://westayfit.app/join/${CODE}/\r\n`)).toBe(`/join/${CODE}`);
    expect(href(` ${CODE}\n`)).toBe(`/join/${CODE}`);
  });
  it('reads westayfit://join/<code> and westayfit:///join/<code>', () => {
    expect(href(`westayfit://join/${CODE}`)).toBe(`/join/${CODE}`);
    expect(href(`westayfit:///join/${CODE}`)).toBe(`/join/${CODE}`);
    expect(href(`WESTAYFIT://join/${CODE}/`)).toBe(`/join/${CODE}`);
  });
  it('ignores a fragment', () => {
    expect(href(`https://westayfit.app/join/${CODE}#top`)).toBe(`/join/${CODE}`);
  });
});

describe('MF-02 case 3: the event parameters are kept', () => {
  it('keeps ?event=<goalId>', () => {
    expect(parse(`https://westayfit.app/join/${CODE}?event=goal_42`)).toEqual({
      code: CODE,
      href: `/join/${CODE}?event=goal_42`,
      event: 'goal_42',
    });
  });
  it('keeps event and activity, in that order, re-encoded', () => {
    expect(href(`https://westayfit.app/join/${CODE}?activity=Jumping%20jacks&event=g1`)).toBe(
      `/join/${CODE}?event=g1&activity=Jumping%20jacks`,
    );
    expect(href(`westayfit://join/${CODE}/?event=g1&activity=Jumping+jacks`)).toBe(
      `/join/${CODE}?event=g1&activity=Jumping%20jacks`,
    );
  });
  it('the kept values are what the join screen reads back', () => {
    const p = parse(`https://westayfit.app/join/${CODE}?event=g1&activity=Squats%20%C3%A0%20deux`)!;
    expect(readEventParam(p.event)).toBe('g1');
    expect(readActivityLabel(p.activity)).toBe('Squats à deux');
    expect(p.href).toBe(`/join/${CODE}?event=g1&activity=${encodeURIComponent('Squats à deux')}`);
  });
  it('drops every other parameter', () => {
    expect(href(`https://westayfit.app/join/${CODE}?utm_source=sms&event=g1&next=/admin&kiosk=1`)).toBe(
      `/join/${CODE}?event=g1`,
    );
    expect(href(`https://westayfit.app/join/${CODE}?Event=g1&EVENT=g2`)).toBe(`/join/${CODE}`);
  });
  it('carries no other key, including prototype keys, in what it returns', () => {
    const p = parse(
      `https://westayfit.app/join/${CODE}?__proto__=x&constructor=y&utm_source=sms&href=/admin&code=zzz&event=g1`,
    )!;
    expect(p).toEqual({ code: CODE, href: `/join/${CODE}?event=g1`, event: 'g1' });
    expect(Object.keys(p).sort()).toEqual(['code', 'event', 'href']);
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
  });
  it('the first of a repeated parameter wins; empty and malformed values are dropped', () => {
    expect(href(`https://westayfit.app/join/${CODE}?event=g1&event=g2`)).toBe(`/join/${CODE}?event=g1`);
    expect(href(`https://westayfit.app/join/${CODE}?event=&event=g2`)).toBe(`/join/${CODE}?event=g2`);
    expect(href(`https://westayfit.app/join/${CODE}?event=%E0%A4%A&activity=ok`)).toBe(`/join/${CODE}?activity=ok`);
    expect(href(`https://westayfit.app/join/${CODE}?event`)).toBe(`/join/${CODE}`);
    expect(href(`https://westayfit.app/join/${CODE}?=g1&&`)).toBe(`/join/${CODE}`);
  });
  it('nothing in a value can add a parameter, a segment or a fragment to the route', () => {
    const p = parse(
      `https://westayfit.app/join/${CODE}?event=g1%26kiosk%3D1%2F..%2F..%23x&activity=%3F%2F%23`,
    )!;
    expect(p.href).toBe(`/join/${CODE}?event=g1%26kiosk%3D1%2F..%2F..%23x&activity=%3F%2F%23`);
    const [path, query] = p.href.split('?');
    expect(path).toBe(`/join/${CODE}`);
    expect(query!.split('&').map((kv) => kv.split('=')[0])).toEqual(['event', 'activity']);
    expect(p.href).not.toMatch(/#|\.\.\//);
    // The join screen refuses this event id itself; it is only carried here.
    expect(readEventParam(p.event)).toBeNull();
  });
});

describe('MF-02 case 4: anything else is "not a valid code" and goes nowhere', () => {
  it.each([
    ['a community link', 'https://westayfit.app/community/x'],
    ['a community link with a code-shaped id', `https://westayfit.app/community/${CODE}`],
    ['a 10-character code', 'abcdefghij'],
    ['a 15-character code', 'a'.repeat(15)],
    ['a 129-character code', 'a'.repeat(129)],
    ['a 10-character code in a link', 'https://westayfit.app/join/abcdefghij'],
    ['/join with no code', 'https://westayfit.app/join'],
    ['/join/ with no code', 'https://westayfit.app/join/'],
    ['an extra segment', `https://westayfit.app/join/${CODE}/extra`],
    ['two trailing slashes', `https://westayfit.app/join/${CODE}//`],
    ['a prefixed path', `https://westayfit.app/x/join/${CODE}`],
    ['a doubled slash', `https://westayfit.app//join/${CODE}`],
    ['a dot segment', `https://westayfit.app/a/../join/${CODE}`],
    ['an encoded slash', `https://westayfit.app/join%2F${CODE}`],
    ['an encoded code', `https://westayfit.app/join/${CODE.slice(0, 5)}%41${CODE.slice(6)}`],
    ['a capitalised path', `https://westayfit.app/Join/${CODE}`],
    ['the code in the query', `https://westayfit.app/join?code=${CODE}`],
    ['the code in the fragment', `https://westayfit.app/#/join/${CODE}`],
    ['the app scheme with another host', `westayfit://evil/join/${CODE}`],
    ['the app scheme without slashes', `westayfit:join/${CODE}`],
    ['a relative path', `/join/${CODE}`],
    ['a schemeless host', `westayfit.app/join/${CODE}`],
    ['a protocol-relative URL', `//westayfit.app/join/${CODE}`],
    ['empty', ''],
    ['whitespace only', '   \n '],
  ])('%s', (_label, raw) => {
    expect(parse(raw)).toBeNull();
  });
});

describe('hostile input', () => {
  it.each([
    ['javascript:', `javascript://westayfit.app/join/${CODE}`],
    ['javascript: with a newline', `javascript:alert(1)//\nhttps://westayfit.app/join/${CODE}`],
    ['data:', `data://text/html/join/${CODE}`],
    ['file:', `file:///join/${CODE}`],
    ['intent:', `intent://join/${CODE}#Intent;scheme=westayfit;end`],
    ['ftp:', `ftp://westayfit.app/join/${CODE}`],
    ['a lookalike app scheme', `westayfit2://join/${CODE}`],
    ['userinfo', `https://westayfit.app@evil.example/join/${CODE}`],
    ['userinfo with a password', `https://u:p@westayfit.app/join/${CODE}`],
    ['an empty host', `https:///join/${CODE}`],
    ['a backslash host', `https://westayfit.app\\@evil/join/${CODE}`],
    ['an underscore host', `https://evil_host/join/${CODE}`],
    ['a host with a space', `https://west ayfit.app/join/${CODE}`],
    ['a long port', `https://westayfit.app:123456/join/${CODE}`],
    ['an internal space', `https://westayfit.app/join/${CODE.slice(0, 8)} ${CODE.slice(8)}`],
    ['an internal newline', `https://westayfit.app/join/${CODE}\n?event=g1`],
    ['a raw space in the query', `https://westayfit.app/join/${CODE}?activity=two words`],
    ['a NUL byte', `https://westayfit.app/join/${CODE}\u0000`],
    ['a tab in the code', `${CODE.slice(0, 8)}\t${CODE.slice(8)}`],
    ['a zero-width space', `${CODE.slice(0, 8)}​${CODE.slice(8)}`],
    ['a homoglyph in the code', `${CODE.slice(0, 8)}а${CODE.slice(9)}`],
    ['full-width characters', `ｈｔｔｐｓ://westayfit.app/join/${CODE}`],
    ['an RTL override', `https://westayfit.app/join/${CODE}‮`],
    ['a code with a dot', `${CODE.slice(0, 8)}.${CODE.slice(9)}`],
    ['a code with a slash', `${CODE.slice(0, 8)}/${CODE.slice(9)}`],
    ['a code with a percent', `${CODE.slice(0, 8)}%${CODE.slice(9)}`],
    ['a code with a query', `${CODE}?event=g1`],
    ['two links pasted together', `https://westayfit.app/join/${CODE}https://westayfit.app/join/${CODE}`],
  ])('%s is refused', (_label, raw) => {
    expect(parse(raw)).toBeNull();
  });

  it('refuses non-strings without throwing', () => {
    for (const raw of [undefined, null, 42, {}, [], ['x'], Symbol('x'), () => CODE, { toString: () => CODE }]) {
      expect(parse(raw)).toBeNull();
    }
  });

  it('refuses input longer than the cap, and stays fast on long adversarial input', () => {
    const longQuery = `https://westayfit.app/join/${CODE}?${'a='.repeat(1000)}`;
    expect(longQuery.length).toBeGreaterThan(JOIN_INPUT_MAX);
    expect(parse(longQuery)).toBeNull();
    const adversarial = [
      `https://${'a-'.repeat(1000)}/join/${CODE}`,
      `https://${'a.'.repeat(1000)}!`,
      `https://${'a'.repeat(2000)}`,
      `${'/'.repeat(2040)}`,
      `https://westayfit.app/${'join/'.repeat(400)}`,
      `https://westayfit.app/join/${CODE}?${'event=%'.repeat(250)}`,
    ];
    const started = Date.now();
    for (const raw of adversarial) parse(raw.slice(0, JOIN_INPUT_MAX));
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('a kept value is always re-encoded, never forwarded raw', () => {
    const p = parse(`https://westayfit.app/join/${CODE}?activity=%0Aline%20two%3Cscript%3E`)!;
    expect(p.activity).toBe('\nline two<script>');
    expect(p.href).toBe(`/join/${CODE}?activity=%0Aline%20two%3Cscript%3E`);
    // And the join screen's own screening still applies on arrival.
    expect(readActivityLabel(p.activity)).toBe('line two<script>');
  });
});

describe("Home's field is wired to the parser (static check of the MF-02 hunk)", () => {
  // The hunk requires the parser inline (it stays inside the member-feature
  // hunk of an integrator-owned file), which vitest cannot execute; this pins
  // the wiring, and the Metro export proves the require resolves.
  const home = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/index.tsx'), 'utf8');
  const start = home.indexOf('const onJoinCodeSubmit = useCallback(');
  const hunk = home.slice(start, home.indexOf('}, [joinCodeInput]);', start));
  it('routes to the parsed href and keeps the refusal copy', () => {
    expect(start).toBeGreaterThan(0);
    expect(hunk).toContain("require('../../../src/joinInput')");
    expect(hunk).toContain('parseJoinInput(joinCodeInput)');
    expect(hunk).toContain("setJoinFieldError('That does not look like a valid code.')");
    expect(hunk).toContain('router.push(parsed.href as never)');
    expect(hunk).not.toContain('JOIN_CODE_SHAPE');
  });
});

describe('N3: an http(s) link is read only from our origins', () => {
  it.each([
    ['another host', `https://evil.example/join/${CODE}`],
    ["a development build's Metro address", `http://192.168.1.20:8081/join/${CODE}`],
    ['Metro on localhost', `http://localhost:8081/join/${CODE}`],
    ['an IPv6 literal', `http://[::1]:8081/join/${CODE}`],
    ['our host over http', `http://westayfit.app/join/${CODE}`],
    ['our host on another port', `https://westayfit.app:8443/join/${CODE}`],
    ['our host with the default port spelled out', `https://westayfit.app:443/join/${CODE}`],
    ['our host with a trailing dot', `https://westayfit.app./join/${CODE}`],
    ['our host as a prefix', `https://westayfit.app.evil.example/join/${CODE}`],
    ['our host as a suffix', `https://evilwestayfit.app/join/${CODE}`],
    ['a hyphenated lookalike', `https://westayfit-app.example/join/${CODE}`],
    ['a subdomain of ours', `https://evil.westayfit.app/join/${CODE}`],
    ['a punycode lookalike', `https://xn--wstayfit-5za.app/join/${CODE}`],
    ['a Cyrillic homoglyph host', `https://wеstayfit.app/join/${CODE}`],
    ['userinfo naming our host', `https://westayfit.app@evil.example/join/${CODE}`],
    ['our host after a backslash', `https://evil.example\\westayfit.app/join/${CODE}`],
    ['an IPv4 literal', `https://203.0.113.7/join/${CODE}`],
  ])('%s is refused', (_label, raw) => {
    expect(parse(raw)).toBeNull();
  });

  it('with no origins at all (the app today), only bare codes and westayfit: links are read', () => {
    expect(parseJoinInput(`https://westayfit.app/join/${CODE}`, [])).toBeNull();
    expect(parseJoinInput(`http://192.168.1.20:8081/join/${CODE}`, [])).toBeNull();
    expect(parseJoinInput(`westayfit://join/${CODE}`, [])?.href).toBe(`/join/${CODE}`);
    expect(parseJoinInput(`westayfit:///join/${CODE}?event=g1`, [])?.href).toBe(`/join/${CODE}?event=g1`);
    expect(parseJoinInput(CODE, [])?.href).toBe(`/join/${CODE}`);
  });
});

describe('N3: inviteOriginsFor', () => {
  it('configured hosts are https, lower-cased and de-duplicated; comma or space separated', () => {
    expect(inviteOriginsFor('ios', ' westayfit.app, Staging.WeStayFit.app  westayfit.app ', null)).toEqual([
      'https://westayfit.app',
      'https://staging.westayfit.app',
    ]);
  });
  it('an entry that is not a plain public host name is ignored', () => {
    expect(
      inviteOriginsFor(
        'android',
        'https://westayfit.app,*.westayfit.app,westayfit.app:443,localhost,192.168.1.20,westayfit.app.,u@westayfit.app,wеstayfit.app,-x.app,ok.example',
        null,
      ),
    ).toEqual(['https://ok.example']);
  });
  it('nothing configured and no page: nothing is ours', () => {
    expect(inviteOriginsFor('ios', undefined, null)).toEqual([]);
    expect(inviteOriginsFor('ios', '', null)).toEqual([]);
  });
  it("on the web the page's own origin is ours, exactly", () => {
    expect(inviteOriginsFor('web', undefined, 'https://goarrive.web.app')).toEqual(['https://goarrive.web.app']);
    expect(inviteOriginsFor('web', undefined, 'http://localhost:8081')).toEqual(['http://localhost:8081']);
    expect(inviteOriginsFor('web', 'westayfit.app', 'https://GoArrive.web.app')).toEqual([
      'https://westayfit.app',
      'https://goarrive.web.app',
    ]);
  });
  it("in the app the page origin is never ours: a development build's location is Metro", () => {
    expect(inviteOriginsFor('ios', undefined, 'http://192.168.1.20:8081')).toEqual([]);
    expect(inviteOriginsFor('android', undefined, 'http://localhost:8081')).toEqual([]);
    expect(inviteOriginsFor('android', 'westayfit.app', 'http://localhost:8081')).toEqual(['https://westayfit.app']);
  });
  it('a malformed page origin is not ours', () => {
    for (const bad of ['null', 'file://', 'https://a@b', 'https://host/path', 'javascript:alert(1)', 'https://', '']) {
      expect(inviteOriginsFor('web', undefined, bad), bad).toEqual([]);
    }
  });
});

describe('N3: the default origins here (vitest runs as the web)', () => {
  const saved = process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = saved;
  });
  it("with nothing configured, the page's own origin is read and any other host is not", () => {
    delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    const own = window.location.origin;
    expect(inviteOrigins()).toEqual([own.toLowerCase()]);
    expect(parseJoinInput(`${own}/join/${CODE}`)?.href).toBe(`/join/${CODE}`);
    expect(parseJoinInput(`https://westayfit.app/join/${CODE}`)).toBeNull();
    expect(parseJoinInput(`westayfit://join/${CODE}`)?.href).toBe(`/join/${CODE}`);
  });
  it('a configured host is read once EXPO_PUBLIC_WSF_INVITE_HOSTS names it', () => {
    process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'westayfit.app';
    expect(parseJoinInput(`https://westayfit.app/join/${CODE}`)?.href).toBe(`/join/${CODE}`);
    expect(parseJoinInput(`https://evil.example/join/${CODE}`)).toBeNull();
  });
});

describe('NB-1: isPublicHost', () => {
  it('a plain public DNS name is public, in any case', () => {
    // `shop.glocal` only ends in the same letters as `local`: whole labels count.
    for (const h of ['westayfit.app', 'staging.westayfit.app', 'GoArrive.Web.App', 'a.b.c.example', 'x1.io', 'shop.glocal']) {
      expect(isPublicHost(h), h).toBe(true);
    }
  });
  it.each([
    ['a single label', 'localhost'],
    ['another single label', 'intranet'],
    ['the Android emulator host', '10.0.2.2'],
    ['a LAN address', '192.168.1.20'],
    ['an IPv6 literal', '[::1]'],
    ['a port', 'westayfit.app:443'],
    ['a trailing dot', 'westayfit.app.'],
    ['a wildcard', '*.westayfit.app'],
    ['an mDNS name', 'my-laptop.local'],
    ['under localhost', 'app.localhost'],
    ['.internal', 'wsf.internal'],
    ['home.arpa', 'nas.home.arpa'],
    ['home.arpa itself (NB-C)', 'home.arpa'],
    ['localhost.localdomain', 'localhost.localdomain'],
    ['a router .lan name', 'nas.lan'],
    ['a router .home name', 'router.home'],
    ['fritz.box', 'fritz.box'],
    ['a leading hyphen', '-x.app'],
    ['empty', ''],
  ])('%s is not', (_l, h) => {
    expect(isPublicHost(h)).toBe(false);
  });
  it('a configured local name is ignored like any other non-public entry', () => {
    expect(inviteOriginsFor('ios', 'my-laptop.local, wsf.internal, ok.example', null)).toEqual(['https://ok.example']);
  });
});

describe('NB-B: configured, configured-but-empty, or not configured', () => {
  it('configuredInviteHosts: null when not configured, [] when every entry is ignored, else the hosts', () => {
    for (const blank of [undefined, '', '   ', ' , ,\n']) expect(configuredInviteHosts(blank), String(blank)).toBeNull();
    for (const ignored of [
      'https://westayfit.app',
      'westayfit.app:443',
      'westayfit.app.',
      '*.westayfit.app',
      'westayfit.internal',
      'abc-8081.exp.direct',
      'laptop.tail1234.ts.net',
      'https://westayfit.app, westayfit.app:443 *.westayfit.app',
    ]) {
      expect(configuredInviteHosts(ignored), ignored).toEqual([]);
    }
    expect(configuredInviteHosts('https://westayfit.app, Staging.WestayFit.app')).toEqual(['staging.westayfit.app']);
  });

  it("configured-but-empty reads no https link at all: not even the web's own origin", () => {
    for (const os of ['web', 'ios', 'android']) {
      expect(inviteOriginsFor(os, 'https://westayfit.app', 'https://goarrive.web.app'), os).toEqual([]);
      expect(inviteOriginsFor(os, 'westayfit.app:443, *.x', 'http://localhost:8081'), os).toEqual([]);
    }
  });

  it('not configured (blank) still reads the web page own origin, as before', () => {
    expect(inviteOriginsFor('web', '  ,  ', 'https://goarrive.web.app')).toEqual(['https://goarrive.web.app']);
  });

  it('a development forwarder is never a configured invite host', () => {
    expect(isDevTunnelHost('abc-8081.exp.direct')).toBe(true);
    expect(isDevTunnelHost('fuzzy-space-8081.app.github.dev')).toBe(true);
    expect(isDevTunnelHost('myexp.direct')).toBe(false);
    expect(inviteOriginsFor('ios', 'abc-8081.exp.direct, westayfit.app', null)).toEqual(['https://westayfit.app']);
  });

  describe('the live default with a misconfigured value (vitest runs as the web)', () => {
    const saved = process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
    afterEach(() => {
      if (saved === undefined) delete process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS;
      else process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = saved;
    });
    it('reads no https invite link, but westayfit: links and bare codes still work', () => {
      process.env.EXPO_PUBLIC_WSF_INVITE_HOSTS = 'https://westayfit.app';
      expect(inviteOrigins()).toEqual([]);
      expect(parseJoinInput(`${window.location.origin}/join/${CODE}`)).toBeNull();
      expect(parseJoinInput(`https://westayfit.app/join/${CODE}`)).toBeNull();
      expect(parseJoinInput(`westayfit://join/${CODE}`)?.href).toBe(`/join/${CODE}`);
      expect(parseJoinInput(CODE)?.href).toBe(`/join/${CODE}`);
    });
  });
});
