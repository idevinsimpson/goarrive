import { describe, expect, it } from 'vitest';

import { movementRequestViolation, type MovementLabRequest } from './helpers/movementNetworkPolicy';

const APP = 'https://lab.example.test';
const SCRIPT = `${APP}/_expo/static/js/web/entry-abc123.js`;
const DOCUMENT = `${APP}/design-target/movement-vision?delegate=cpu`;
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const EXPECTED = new Set([SCRIPT, DOCUMENT, WASM, MODEL]);
const request = (url: string, changes: Partial<MovementLabRequest> = {}): MovementLabRequest => ({
  url, method: 'GET', bodyBytes: 0, ...changes,
});

describe('movement lab egress policy — exact static resources, no uploads', () => {
  it.each([SCRIPT, DOCUMENT, WASM, MODEL])('allows the predeclared GET resource %s', (url) => {
    expect(movementRequestViolation(request(url), EXPECTED)).toBeNull();
  });

  it('rejects a same-origin upload even when its URL is an allowed static resource', () => {
    expect(movementRequestViolation(request(SCRIPT, { method: 'POST', bodyBytes: 1024 }), EXPECTED))
      .toBe('Unexpected request method: POST');
  });

  it('rejects an empty POST as well as an upload body', () => {
    expect(movementRequestViolation(request(MODEL, { method: 'POST' }), EXPECTED))
      .toBe('Unexpected request method: POST');
  });

  it('rejects a body on an otherwise allowed GET', () => {
    expect(movementRequestViolation(request(WASM, { bodyBytes: 1 }), EXPECTED))
      .toBe('Request body is not empty');
  });

  it.each([
    `${APP}/upload`,
    `${APP}/frames/private-frame.jpg`,
    'https://unexpected.example.test/telemetry',
    WASM.replace('@0.10.35/', '@1.0.0/'),
    WASM.replace('vision_wasm_internal.wasm', 'upload'),
  ])('rejects an unlisted URL even at a trusted origin: %s', (url) => {
    expect(movementRequestViolation(request(url), EXPECTED)).toContain('not an expected static asset');
  });

  it.each([
    `${SCRIPT}?frame=private-data`,
    `${WASM}?landmarks=private-data`,
    `${MODEL}?count=10`,
    `${DOCUMENT}&frame=private-data`,
    DOCUMENT.replace('delegate=cpu', 'delegate=private-data'),
  ])('rejects query-carried data: %s', (url) => {
    expect(movementRequestViolation(request(url), EXPECTED)).toBe('Unexpected request query');
  });

  it.each(['wss://lab.example.test/stream', 'data:application/json,private-data', 'blob:https://lab.example.test/id'])
    ('rejects undeclared protocols: %s', (url) => {
      expect(movementRequestViolation(request(url), EXPECTED)).toContain('Unexpected request protocol');
    });

  it('rejects credentials and malformed URLs', () => {
    expect(movementRequestViolation(request(SCRIPT.replace('https://', 'https://name:secret@')), EXPECTED))
      .toBe('Credentials or fragment in request URL');
    expect(movementRequestViolation(request('not a URL'), EXPECTED)).toBe('Malformed request URL');
  });
});
