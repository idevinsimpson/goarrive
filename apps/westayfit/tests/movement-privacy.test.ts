import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { movementLabAllowed } from '../src/movement/labGate';
import { BLAZEPOSE_INDEX, MEDIAPIPE_VERSION, mapBlazePose } from '../src/movement/web/mediapipe';

/**
 * THE PRIVACY STATEMENT, AS CHECKS THAT CAN FAIL.
 *
 * "Camera frames stay on the device and are never recorded, stored or
 * uploaded; nothing is written to Firebase." These are static guardrails, not
 * a complete proof of runtime behavior or every dependency's behavior. They
 * make a later edit that adds a recorder,
 * a canvas readback, a network call, storage or a Firebase import fails here
 * rather than in review.
 */

const APP = join(__dirname, '..');
const MOVEMENT = join(APP, 'src', 'movement');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Strip comments so the explanations of what is forbidden do not trip the scan. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: [string, RegExp][] = [
  ['recording (MediaRecorder)', /\bMediaRecorder\b/],
  ['canvas readback (toDataURL)', /\btoDataURL\b/],
  ['canvas readback (toBlob)', /\btoBlob\b/],
  ['pixel readback (getImageData)', /\bgetImageData\b/],
  ['stream capture (captureStream)', /\bcaptureStream\b/],
  ['network (fetch)', /\bfetch\s*\(/],
  ['network (XMLHttpRequest)', /\bXMLHttpRequest\b/],
  ['network (sendBeacon)', /\bsendBeacon\b/],
  ['network (WebSocket)', /\bWebSocket\b/],
  ['storage (localStorage)', /\blocalStorage\b/],
  ['storage (sessionStorage)', /\bsessionStorage\b/],
  ['storage (indexedDB)', /\bindexedDB\b/],
  ['Firebase', /firebase/i],
  ['the shared contribution path', /contributionFlow|pendingContribution|moveSession/],
];

describe('movement code: frames stay local, nothing is persisted or sent', () => {
  const files = sources(MOVEMENT);

  it('finds the movement sources', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  for (const [what, re] of FORBIDDEN) {
    it(`uses no ${what}`, () => {
      const offenders = files.filter((f) => re.test(code(f)));
      expect(offenders).toEqual([]);
    });
  }

  it('the route file writes nothing either', () => {
    const route = code(join(APP, 'app', 'design-target', 'movement-vision.tsx'));
    for (const [, re] of FORBIDDEN) expect(re.test(route)).toBe(false);
  });

  it('checks the executed CJS import and both pinned bundles for the reviewed metrics endpoint', () => {
    const pkg = JSON.parse(
      readFileSync(join(APP, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'), 'utf8'),
    );
    expect(pkg.version).toBe(MEDIAPIPE_VERSION);
    const appPkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
    expect(appPkg.dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION);
    // Parse the actual runtime require, so a comment or type-only import cannot
    // make this test inspect one artifact while Metro executes another.
    const adapter = ts.createSourceFile(
      'tasksVision.ts',
      readFileSync(join(MOVEMENT, 'web', 'tasksVision.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const requires: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const target = node.arguments[0];
        if (node.arguments.length !== 1 || !target || !ts.isStringLiteral(target)) {
          throw new Error('The MediaPipe runtime import must remain a literal, reviewable target');
        }
        requires.push(target.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(adapter);
    expect(requires).toEqual(['@mediapipe/tasks-vision/vision_bundle.cjs']);
    for (const file of ['vision_bundle.cjs', 'vision_bundle.mjs']) {
      const bundle = readFileSync(join(APP, 'node_modules', '@mediapipe', 'tasks-vision', file), 'utf8');
      // A narrow regression for the known endpoint, not a claim that a text
      // scan alone proves all possible egress absent. The browser policy also
      // rejects unexpected methods, bodies, queries and destinations.
      expect(bundle.includes('odml.pa.googleapis.com'), file).toBe(false);
    }
  });
});

describe('the lab gate', () => {
  it('is closed unless the emulator/capture flag is on', () => {
    expect(movementLabAllowed(undefined)).toBe(false);
    expect(movementLabAllowed('')).toBe(false);
    expect(movementLabAllowed('0')).toBe(false);
    expect(movementLabAllowed('false')).toBe(false);
    expect(movementLabAllowed('yes')).toBe(false);
    expect(movementLabAllowed('1')).toBe(true);
    expect(movementLabAllowed(' TRUE ')).toBe(true);
  });

  it('the route renders the lab only behind the gate', () => {
    const route = code(join(APP, 'app', 'design-target', 'movement-vision.tsx'));
    expect(route).toMatch(/if \(!movementLabAllowed\(\)\)/);
  });

  it('no other screen links to the lab', () => {
    const appFiles = sources(join(APP, 'app')).filter((f) => !f.endsWith('movement-vision.tsx'));
    const srcFiles = sources(join(APP, 'src')).filter((f) => !f.startsWith(MOVEMENT));
    const linking = [...appFiles, ...srcFiles].filter((f) => /movement-vision/.test(readFileSync(f, 'utf8')));
    expect(linking).toEqual([]);
  });
});

describe('mapBlazePose — the web adapter mapping', () => {
  function raw(overrides: Record<number, { x: number; y: number; visibility?: number }> = {}) {
    const out: { x: number; y: number; visibility?: number }[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.9,
    }));
    for (const [i, v] of Object.entries(overrides)) out[Number(i)] = v;
    return out;
  }

  it('maps the BlazePose indices to the named keypoints', () => {
    const r = raw({ [BLAZEPOSE_INDEX.leftAnkle]: { x: 0.61, y: 0.93, visibility: 0.8 } });
    expect(mapBlazePose(r).leftAnkle).toEqual({ x: 0.61, y: 0.93, visibility: 0.8 });
  });

  it('an off-frame (extrapolated) joint is not visible', () => {
    const r = raw({ [BLAZEPOSE_INDEX.rightAnkle]: { x: 0.5, y: 1.2, visibility: 0.99 } });
    expect(mapBlazePose(r).rightAnkle!.visibility).toBe(0);
  });

  it('a joint without a reported visibility is not visible', () => {
    const r = raw({ [BLAZEPOSE_INDEX.leftKnee]: { x: 0.5, y: 0.7 } });
    expect(mapBlazePose(r).leftKnee!.visibility).toBe(0);
  });
});
