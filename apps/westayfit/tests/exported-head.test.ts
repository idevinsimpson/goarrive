// The <head> of every exported page is the ONLY thing a link unfurler ever
// sees: iMessage, Slack, WhatsApp and X fetch the static shell and never run
// the bundle. So the share identity is produced by a build step
// (scripts/westayfit/inject_meta.py) and is tested the way it runs — the real
// script, in a child process, over fixture pages, with a real environment.
//
// What is pinned here:
//   - every required tag is present on every exported route;
//   - og:image is an ABSOLUTE https URL with its dimensions declared (a
//     relative image is silently dropped by every unfurler, and an image
//     without declared dimensions renders as a small card);
//   - the per-route title and description;
//   - a staging build says so, and ONLY a staging build does;
//   - a production build carries no trace of a staging origin;
//   - no community, goal, member or route-parameter value reaches the head —
//     this tier is the global fallback, by design;
//   - robots stays noindex,nofollow, which the browser suite also asserts.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const INJECTOR = path.resolve(__dirname, '../../../scripts/westayfit/inject_meta.py');

const PROD_ORIGIN = 'https://westayfit-app.web.app';
const STAGING_PROJECT = 'wsf-staging';
const STAGING_ORIGIN = `https://${STAGING_PROJECT}.firebaseapp.com`;

/** Every exported page shape the injector has to cover. */
const FIXTURES = {
  home: 'index.html',
  join: 'join/[joinCode].html',
  display: 'display/[goalId].html',
  contribute: 'contribute/[goalId].html',
  kiosk: 'kiosk/[goalId].html',
  combined: 'combined/[setupId].html',
  signin: 'signin.html',
  goalsNew: 'goals/new.html',
  challenge: 'community/[groupId]/challenge.html',
  notFound: '+not-found.html',
} as const;

/**
 * Expo's static export also writes a route that lives inside a route group at
 * every combination of its group segments. The router never serves these
 * parenthesised addresses; the injector must not demand a rewrite for them.
 * They are written into the fixture tree beside the real pages but are not
 * routes of their own, so they carry no copy and are not in ROUTES.
 */
const GROUP_EXPORT_DUPLICATES = [
  '(tabs)/(home)/community/[groupId]/challenge.html',
  '(tabs)/(home)/index.html',
] as const;

type RouteName = keyof typeof FIXTURES;

/**
 * A page as Expo exports it: one real <title>, plus the empty
 * `data-rh` title react-helmet owns at runtime.
 */
const PAGE = [
  '<!DOCTYPE html><html lang="en"><head>',
  '<title>We Stay Fit</title>',
  '<meta name="description" content="stale">',
  '<title data-rh="true"></title><meta charSet="utf-8"/>',
  '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no"/>',
  '</head><body><div id="root"></div></body></html>',
].join('');

const temps: string[] = [];

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Run = {
  status: number;
  stdout: string;
  stderr: string;
  pages: Record<RouteName, string>;
  /** The fixture tree the injector just ran over, so a test can look at the
   * `__dynamic` aliases it wrote as well as the pages it rewrote. */
  dist: string;
};

/** Run the real injector over a fresh fixture tree with exactly this env. */
function runInjector(env: Record<string, string>, { expectFailure = false } = {}): Run {
  const dist = mkdtempSync(path.join(tmpdir(), 'wsf-head-'));
  temps.push(dist);
  for (const rel of [...Object.values(FIXTURES), ...GROUP_EXPORT_DUPLICATES]) {
    const abs = path.join(dist, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, PAGE, 'utf8');
  }

  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('python3', [INJECTOR], {
      encoding: 'utf8',
      // A deliberately minimal environment: the injector must read what the build
      // passes it, not whatever happens to be exported in this shell.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ...env,
        WSF_META_DIST_ROOT: dist,
      } as unknown as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  if (!expectFailure) {
    expect(status, `injector failed:\n${stderr}`).toBe(0);
  }

  const pages = {} as Record<RouteName, string>;
  for (const [name, rel] of Object.entries(FIXTURES) as [RouteName, string][]) {
    pages[name] = expectFailure ? '' : readFileSync(path.join(dist, rel), 'utf8');
  }
  return { status, stdout, stderr, pages, dist };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function meta(html: string, key: string): string | null {
  const doc = parse(html);
  const el =
    doc.querySelector(`meta[property="${key}"]`) ?? doc.querySelector(`meta[name="${key}"]`);
  return el ? el.getAttribute('content') : null;
}

function link(html: string, rel: string): string | null {
  const el = parse(html).querySelector(`link[rel="${rel}"]`);
  return el ? el.getAttribute('href') : null;
}

function title(html: string): string {
  return parse(html).title;
}

const PROD_ENV = {
  EXPO_PUBLIC_WSF_PUBLIC_ORIGIN: PROD_ORIGIN,
  EXPO_PUBLIC_WSF_AUTH_ENABLED: '1',
};

const STAGING_ENV = {
  EXPO_PUBLIC_WSF_ENV: 'staging',
  EXPO_PUBLIC_WSF_AUTH_ENABLED: '1',
  EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: STAGING_PROJECT,
  EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: `${STAGING_PROJECT}.firebaseapp.com`,
};

const production = runInjector(PROD_ENV);
const staging = runInjector(STAGING_ENV);

const ROUTE_COPY: Record<RouteName, { title: string; description: string }> = {
  home: { title: 'WE STAY FIT', description: 'Shared challenges. More movement. Stronger communities.' },
  join: {
    title: 'Join a community | WE STAY FIT',
    description: 'Join a WE STAY FIT community and move toward a shared goal.',
  },
  display: {
    title: 'Community goal | WE STAY FIT',
    description: "A community's shared progress on WE STAY FIT.",
  },
  contribute: {
    title: 'Add your part | WE STAY FIT',
    description: 'Shared challenges. More movement. Stronger communities.',
  },
  kiosk: {
    title: 'Kiosk | WE STAY FIT',
    description: 'Shared challenges. More movement. Stronger communities.',
  },
  combined: {
    title: 'Combined goal | WE STAY FIT',
    description: 'Shared challenges. More movement. Stronger communities.',
  },
  signin: { title: 'WE STAY FIT', description: 'Shared challenges. More movement. Stronger communities.' },
  goalsNew: { title: 'WE STAY FIT', description: 'Shared challenges. More movement. Stronger communities.' },
  challenge: { title: 'WE STAY FIT', description: 'Shared challenges. More movement. Stronger communities.' },
  notFound: { title: 'WE STAY FIT', description: 'Shared challenges. More movement. Stronger communities.' },
};

const ROUTES = Object.keys(FIXTURES) as RouteName[];

describe('exported head — every page', () => {
  it.each(ROUTES)('%s carries the complete share identity', (route) => {
    const html = production.pages[route];

    expect(meta(html, 'og:type')).toBe('website');
    expect(meta(html, 'og:site_name')).toBe('WE STAY FIT');
    expect(meta(html, 'og:title')).toBe(ROUTE_COPY[route].title);
    expect(meta(html, 'og:description')).toBe(ROUTE_COPY[route].description);
    expect(meta(html, 'og:url')).toBeTruthy();

    expect(meta(html, 'og:image')).toBe(`${PROD_ORIGIN}/og/wsf-share.png`);
    expect(meta(html, 'og:image:width')).toBe('1200');
    expect(meta(html, 'og:image:height')).toBe('630');
    expect(meta(html, 'og:image:alt')).toBe(
      'WE STAY FIT — Turn your community into a place that moves.'
    );

    expect(meta(html, 'twitter:card')).toBe('summary_large_image');
    expect(meta(html, 'twitter:title')).toBe(ROUTE_COPY[route].title);
    expect(meta(html, 'twitter:description')).toBe(ROUTE_COPY[route].description);
    expect(meta(html, 'twitter:image')).toBe(`${PROD_ORIGIN}/og/wsf-share.png`);

    expect(meta(html, 'theme-color')).toBe('#0B1F3A');
    expect(link(html, 'manifest')).toBe('/manifest.webmanifest');
    expect(link(html, 'apple-touch-icon')).toBe('/icons/apple-touch-icon-180.png');
    expect(link(html, 'icon')).toBe('/icons/favicon-32.png');
    expect(link(html, 'canonical')).toBeTruthy();
  });

  it.each(ROUTES)('%s keeps robots noindex,nofollow', (route) => {
    expect(meta(production.pages[route], 'robots')).toBe('noindex,nofollow');
    expect(meta(staging.pages[route], 'robots')).toBe('noindex,nofollow');
  });

  it.each(ROUTES)('%s has the per-route title and description', (route) => {
    const html = production.pages[route];
    expect(title(html)).toBe(ROUTE_COPY[route].title);
    expect(meta(html, 'description')).toBe(ROUTE_COPY[route].description);
  });

  it.each(ROUTES)('%s has exactly one of each tag this script owns', (route) => {
    const doc = parse(production.pages[route]);
    for (const selector of [
      'meta[name="description"]',
      'meta[name="robots"]',
      'meta[name="theme-color"]',
      'meta[property="og:image"]',
      'meta[property="og:title"]',
      'meta[name="twitter:card"]',
      'link[rel="canonical"]',
      'link[rel="manifest"]',
      'link[rel="apple-touch-icon"]',
    ]) {
      expect(doc.querySelectorAll(selector).length, selector).toBe(1);
    }
    // Ours is the title the document resolves to; react-helmet's empty one stays.
    expect(doc.querySelectorAll('title').length).toBe(2);
    expect(doc.title).toBe(ROUTE_COPY[route].title);
  });

  it.each(ROUTES)('%s canonicalises to an absolute https URL on this origin', (route) => {
    const canonical = link(production.pages[route], 'canonical') as string;
    expect(canonical.startsWith(`${PROD_ORIGIN}/`)).toBe(true);
    expect(meta(production.pages[route], 'og:url')).toBe(canonical);
  });

  it('canonicalises a static route to its own path and a dynamic template to the root', () => {
    // A static page names itself.
    expect(link(production.pages.signin, 'canonical')).toBe(`${PROD_ORIGIN}/signin`);
    expect(link(production.pages.goalsNew, 'canonical')).toBe(`${PROD_ORIGIN}/goals/new`);
    expect(link(production.pages.home, 'canonical')).toBe(`${PROD_ORIGIN}/`);
    // A dynamic template serves many URLs and has no route data at this tier,
    // so it must not publish a URL it cannot name — and must never publish the
    // bracket template or its internal `__dynamic` hosting alias.
    for (const route of [
      'join',
      'display',
      'contribute',
      'kiosk',
      'combined',
      'challenge',
    ] as RouteName[]) {
      expect(link(production.pages[route], 'canonical')).toBe(`${PROD_ORIGIN}/`);
    }
  });
});

describe('exported head — the combined movement goal route', () => {
  // A dynamic route only resolves on a cold reload because the build writes a
  // `__dynamic` alias AND Hosting declares a rewrite to it. The injector fails
  // the build when an alias has no declared destination, so the pairing below
  // is what makes `/combined/<setupId>` survive a reload in a browser that has
  // never seen the app — the same mechanism `/kiosk/<goalId>` already relies on.
  it('emits the __dynamic alias the Hosting rewrite points at', () => {
    expect(existsSync(path.join(production.dist, 'combined/__dynamic.html'))).toBe(true);
  });

  it('is a declared rewrite destination, prefix-disjoint from /kiosk/**', () => {
    const hosting = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../firebase.westayfit.json'), 'utf8')
    ) as { hosting: { rewrites: Array<{ source: string; destination: string }> } };
    const rewrite = hosting.hosting.rewrites.find((r) => r.source === '/combined/**');
    expect(rewrite?.destination).toBe('/combined/__dynamic.html');
    // Nested under /kiosk/** it would have been served by the single-goal
    // kiosk page instead, whatever order the entries were written in.
    expect(rewrite?.source.startsWith('/kiosk/')).toBe(false);
  });

  it('the emulator harness declares the identical rewrite', () => {
    // The e2e battery runs against the emulator config; if the two drift the
    // harness stops testing what actually ships.
    const emu = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../firebase.westayfit.emulators.json'), 'utf8')
    ) as { hosting: { rewrites: Array<{ source: string; destination: string }> } };
    expect(emu.hosting.rewrites).toContainEqual({
      source: '/combined/**',
      destination: '/combined/__dynamic.html',
    });
  });
});

describe('exported head — route-group export duplicates', () => {
  // W9's migration puts the member destinations under `(tabs)/(home)`; the
  // export then emits `(tabs)/(home)/community/[groupId]/challenge.html` beside
  // the `community/[groupId]/challenge.html` the router actually serves. The
  // guard must keep failing a real dynamic route with no rewrite (covered
  // above) while ignoring these copies, or no build with a route group passes.
  it('does not demand a rewrite for a dynamic route exported under a group segment', () => {
    expect(production.status).toBe(0);
    expect(production.stdout).toContain(
      'WSF dynamic route skipped: (tabs)/(home)/community/[groupId]/challenge.html  [route-group export duplicate]'
    );
    expect(existsSync(path.join(production.dist, '(tabs)/(home)/community/__dynamic/challenge.html'))).toBe(false);
  });

  it('still aliases and routes the group-free copy of the same route', () => {
    expect(production.stdout).toContain(
      'WSF dynamic route aliased: community/[groupId]/challenge.html -> /community/__dynamic/challenge.html  [routed]'
    );
    expect(existsSync(path.join(production.dist, 'community/__dynamic/challenge.html'))).toBe(true);
  });
});

describe('exported head — nothing private or internal leaks', () => {
  it.each(ROUTES)('%s head contains no route parameter, id or internal path', (route) => {
    const head = production.pages[route].split('</head>')[0];
    for (const forbidden of [
      '[joinCode]',
      '[goalId]',
      '[groupId]',
      '[setupId]',
      '__dynamic',
      'uid',
      '@',
      'goalId:',
      'communityGroupId:',
    ]) {
      expect(head, `${route} head must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never carries a per-community or per-goal claim: every page shares one card', () => {
    const images = ROUTES.map((r) => meta(production.pages[r], 'og:image'));
    expect(new Set(images).size).toBe(1);
  });
});

describe('exported head — staging designation', () => {
  it.each(ROUTES)('%s says staging in a staging build', (route) => {
    const html = staging.pages[route];
    expect(meta(html, 'og:title')).toBe(`${ROUTE_COPY[route].title} (staging)`);
    expect(meta(html, 'twitter:title')).toBe(`${ROUTE_COPY[route].title} (staging)`);
    expect(title(html)).toBe(`${ROUTE_COPY[route].title} (staging)`);
    const staged = `Staging — test data. ${ROUTE_COPY[route].description}`;
    expect(meta(html, 'description')).toBe(staged);
    expect(meta(html, 'og:description')).toBe(staged);
    expect(meta(html, 'twitter:description')).toBe(staged);
  });

  it('serves a staging build its own origin, and no production origin', () => {
    const html = staging.pages.home;
    expect(meta(html, 'og:image')).toBe(`${STAGING_ORIGIN}/og/wsf-share.png`);
    expect(link(html, 'canonical')).toBe(`${STAGING_ORIGIN}/`);
    expect(html.split('</head>')[0]).not.toContain(PROD_ORIGIN);
  });

  it.each(ROUTES)('%s in a production build says nothing about staging', (route) => {
    const head = production.pages[route].split('</head>')[0];
    expect(head).not.toContain('(staging)');
    expect(head).not.toContain('Staging —');
    expect(head).not.toContain(STAGING_ORIGIN);
    expect(head.toLowerCase()).not.toContain('staging');
  });
});

describe('exported head — the origin is never guessed', () => {
  // With nothing in the environment the origin is not invented: it is read
  // from the Hosting site this repository itself declares the dist is served
  // from, so an ordinary `npm run build:web` (every local gate, capture run
  // and scripts/westayfit/gate1.sh) produces correct absolute URLs instead of
  // failing, while an explicit origin and a staging build still win above it.
  it('falls back to the Hosting site declared in firebase.westayfit.json', () => {
    const declaredSite = (
      JSON.parse(
        readFileSync(path.resolve(__dirname, '../../../firebase.westayfit.json'), 'utf8')
      ) as { hosting: { site: string } }
    ).hosting.site;
    const declaredOrigin = `https://${declaredSite}.web.app`;
    const html = runInjector({ EXPO_PUBLIC_WSF_AUTH_ENABLED: '1' }).pages.home;
    expect(meta(html, 'og:image')).toBe(`${declaredOrigin}/og/wsf-share.png`);
    expect(meta(html, 'og:url')).toBe(`${declaredOrigin}/`);
    expect(link(html, 'canonical')).toBe(`${declaredOrigin}/`);
    // A fallback origin never turns a plain build into a staging one.
    expect(html.toLowerCase()).not.toContain('staging');
  });

  // The defect this guards: a staging build advertised https://<project>.firebaseapp.com
  // (the Firebase Auth handler) while it was actually served from the Hosting
  // preview channel, so every og:image and canonical URL pointed at a 404.
  // authDomain does not identify the channel, and must never stand in for it.
  it('a staging build advertises the deployed CHANNEL origin, not the Auth domain', () => {
    const CHANNEL = 'https://westayfit-staging--staging-4a616y5m.web.app';
    const AUTH_HOST = 'westayfit-staging.firebaseapp.com';
    const html = runInjector({
      EXPO_PUBLIC_WSF_ENV: 'staging',
      EXPO_PUBLIC_WSF_AUTH_ENABLED: '1',
      EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: STAGING_PROJECT,
      EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: `${STAGING_PROJECT}.firebaseapp.com`,
      STAGING_URL: CHANNEL,
    }).pages.home;
    expect(meta(html, 'og:image')).toBe(`${CHANNEL}/og/wsf-share.png`);
    expect(meta(html, 'twitter:image')).toBe(`${CHANNEL}/og/wsf-share.png`);
    expect(meta(html, 'og:url')).toBe(`${CHANNEL}/`);
    expect(link(html, 'canonical')).toBe(`${CHANNEL}/`);
    // The Auth host must appear nowhere in the head, even though this build
    // knows it: the two values are deliberately different in this fixture.
    expect(html).not.toContain(AUTH_HOST);
    // A staging build is still designated as one.
    expect(html.toLowerCase()).toContain('staging');
  });

  it('the advertised share image is a file this build actually ships', () => {
    const CHANNEL = 'https://westayfit-staging--staging-4a616y5m.web.app';
    const html = runInjector({
      EXPO_PUBLIC_WSF_ENV: 'staging',
      EXPO_PUBLIC_WSF_AUTH_ENABLED: '1',
      EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: STAGING_PROJECT,
      EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: `${STAGING_PROJECT}.firebaseapp.com`,
      STAGING_URL: CHANNEL,
    }).pages.home;
    const advertised = meta(html, 'og:image')!;
    expect(advertised.startsWith(`${CHANNEL}/`)).toBe(true);
    // Whatever path the head advertises must exist under public/, which is
    // copied to the site root; otherwise the URL 404s wherever it is served.
    const servedPath = advertised.slice(CHANNEL.length + 1);
    expect(existsSync(path.resolve(__dirname, '../public', servedPath))).toBe(true);
  });

  it('an explicit origin still wins over the declared Hosting site', () => {
    const html = runInjector({
      EXPO_PUBLIC_WSF_PUBLIC_ORIGIN: 'https://example-origin.web.app',
      EXPO_PUBLIC_WSF_AUTH_ENABLED: '1',
    }).pages.home;
    expect(meta(html, 'og:url')).toBe('https://example-origin.web.app/');
    expect(html).not.toContain('westayfit-app.web.app');
  });

  it('refuses an origin that is not https', () => {
    const run = runInjector(
      { EXPO_PUBLIC_WSF_PUBLIC_ORIGIN: 'http://westayfit-app.web.app' },
      { expectFailure: true }
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('not an https origin');
  });

  it('refuses a staging build whose staging values disagree about the project', () => {
    const run = runInjector(
      {
        EXPO_PUBLIC_WSF_ENV: 'staging',
        EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: 'wsf-staging',
        EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'something-else.firebaseapp.com',
      },
      { expectFailure: true }
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('two different projects');
  });

  it('refuses a staging build that advertises the production project', () => {
    const run = runInjector(
      {
        EXPO_PUBLIC_WSF_ENV: 'staging',
        EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: 'goarrive',
        EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'goarrive.firebaseapp.com',
      },
      { expectFailure: true }
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('PRODUCTION project');
  });

  it('lets an explicit origin win over the staging fallback', () => {
    const run = runInjector({ ...STAGING_ENV, EXPO_PUBLIC_WSF_PUBLIC_ORIGIN: 'https://wsf-staging.web.app' });
    expect(meta(run.pages.home, 'og:image')).toBe('https://wsf-staging.web.app/og/wsf-share.png');
    // It is still a staging build, so it still says so.
    expect(meta(run.pages.home, 'og:title')).toBe('WE STAY FIT (staging)');
  });
});

describe('exported head — the share image the metadata promises exists', () => {
  it('is a 1200x630 PNG in the published public directory', () => {
    const png = readFileSync(path.resolve(__dirname, '../public/og/wsf-share.png'));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // IHDR width/height, big-endian, at fixed offsets in every PNG.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it.each([
    ['icons/icon-512.png', 512],
    ['icons/apple-touch-icon-180.png', 180],
    ['icons/favicon-32.png', 32],
  ])('%s is a square %ipx PNG', (rel, size) => {
    const png = readFileSync(path.resolve(__dirname, '../public', rel as string));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  });

  it('the manifest the head links to names the same brand and colour', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, '../public/manifest.webmanifest'), 'utf8')
    ) as { name: string; theme_color: string; icons: Array<{ src: string; sizes: string }> };
    expect(manifest.name).toBe('WE STAY FIT');
    expect(manifest.theme_color).toBe('#0B1F3A');
    expect(manifest.icons.map((i) => i.src)).toContain('/icons/icon-512.png');
  });
});
