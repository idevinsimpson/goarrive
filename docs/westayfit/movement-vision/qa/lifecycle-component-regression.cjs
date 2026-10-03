/**
 * Deterministic component-source regression instrument.
 *
 * Usage (from repository root after installing the WSF app dev dependencies):
 *   node docs/westayfit/movement-vision/qa/lifecycle-component-regression.cjs [source-root]
 *
 * source-root may be a repository root, apps/westayfit, or its src/movement
 * directory. It defaults to this script's repository. Run this same file
 * against the accepted R&D checkout and the candidate to prove discrimination.
 *
 * Executes the selected component and its dependent TypeScript source with
 * mocked React hooks, Expo focus callbacks, DOM events, camera permission,
 * pose estimator and RAF. State/ref slots survive explicit mock rerenders,
 * while actual registered focus/effect cleanup callbacks drive cancellation.
 * This is NOT a mounted React test, browser test, camera test, real-person
 * accuracy proof, native proof or owner device acceptance. No camera is opened.
 * No images, frames, real poses or personal data are read or stored.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

const selected = path.resolve(process.argv[2] || path.join(__dirname, '../../../..'));
const roots = [selected, path.join(selected, 'src/movement'), path.join(selected, 'apps/westayfit/src/movement')];
const BASE = roots.find((candidate) => fs.existsSync(path.join(candidate, 'MovementVisionLab.web.tsx')));
if (!BASE) throw new Error('source-root must contain the WSF movement source, app, or repository.');
const APP = path.resolve(BASE, '../..');
const ts = createRequire(path.join(APP, 'package.json'))('typescript');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function eventTarget(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { for (const callback of [...(listeners.get(type) || [])]) callback({ type }); },
  };
}

function fakeStream(name) {
  const track = eventTarget({
    stops: 0,
    kind: 'video',
    readyState: 'live',
    stop() { this.stops++; this.readyState = 'ended'; },
  });
  return { name, track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function harness() {
  const gum = [], models = [], states = [], cleanups = [], refs = [], focusEffects = [];
  const frames = new Map();
  let frameId = 0, engineCalls = 0, refIndex = 0, stateIndex = 0;
  let rendered = false, tree;
  const video = eventTarget({
    srcObject: null, play: async () => {}, pause() {}, error: null,
    readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480,
  });
  const canvas = { width: 640, height: 480, getContext: () => ({ clearRect() {} }) };
  const document = eventTarget({ hidden: false, visibilityState: 'visible' });
  const window = eventTarget({ location: { search: '' } });
  const defaultEngine = {
    engine: 'audit mock', maxPoses: 3, closes: 0,
    close() { this.closes++; },
    estimate(_video, timestampMs) { return { timestampMs, poses: [] }; },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = {
    useRef(value) {
      const i = refIndex++;
      if (!refs[i]) refs[i] = { current: value };
      return refs[i];
    },
    useState(value) {
      const i = stateIndex++;
      if (!states[i]) states[i] = { value };
      return [states[i].value, (next) => {
        states[i].value = typeof next === 'function' ? next(states[i].value) : next;
      }];
    },
    useCallback: (fn) => fn,
    useEffect(fn) {
      // These tests keep component dependencies constant across explicit renders.
      if (rendered) return;
      const cleanup = fn();
      if (cleanup) cleanups.push(cleanup);
    },
  };
  const stubs = {
    react,
    'expo-router': {
      useFocusEffect(fn) {
        if (rendered) return;
        focusEffects.push({ fn, cleanup: fn(), focused: true });
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Text: 'Text', View: 'View', ScrollView: 'ScrollView' },
    './LabParts': {
      CountPanel: 'CountPanel', LabBanner: 'LabBanner', LabButton: 'LabButton',
      Row: 'Row', PRIVACY_LINE: 'local', labStyles: {}, stateColor: () => '',
    },
    './web/overlay': { drawOverlay() {} },
    './web/mediapipe': {
      createMediaPipeEstimator() {
        engineCalls++;
        return models.length ? models.shift().promise : Promise.resolve(defaultEngine);
      },
    },
  };
  const ctx = vm.createContext({
    console, process, setTimeout, clearTimeout, URLSearchParams, document, window,
    performance: { now: () => 0 },
    navigator: { mediaDevices: { getUserMedia() {
      const request = deferred();
      gum.push(request);
      return request.promise;
    } } },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs.readFileSync(file, 'utf8');
    const compiled = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const fn = vm.runInContext('(function(require,module,exports){' + compiled + '\n})', ctx, { filename: file });
    fn((id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id.startsWith('.')) {
        const location = path.resolve(path.dirname(file), id);
        return load(fs.existsSync(location + '.ts') ? location + '.ts' : location + '.tsx');
      }
      return require(id);
    }, module, module.exports);
    return module.exports;
  }
  const Component = load(path.join(BASE, 'MovementVisionLab.web.tsx')).MovementVisionLab;
  function visit(node, fn) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, fn));
    if (typeof node !== 'object') return;
    fn(node);
    visit(node.props?.children, fn);
  }
  function render() {
    refIndex = stateIndex = 0;
    tree = Component();
    rendered = true;
    visit(tree, (node) => {
      if (node.type === 'video') node.props.ref.current = video;
      if (node.type === 'canvas') node.props.ref.current = canvas;
    });
  }
  render();
  function click(id) {
    render();
    let found;
    visit(tree, (node) => { if (node.props?.testID === id) found = node; });
    assert(found, 'missing control: ' + id);
    return found.props.onPress();
  }
  function blur() {
    for (const effect of focusEffects) {
      if (!effect.focused) continue;
      effect.focused = false;
      effect.cleanup?.();
    }
  }
  function focus() {
    for (const effect of focusEffects) {
      if (effect.focused) continue;
      effect.focused = true;
      effect.cleanup = effect.fn();
    }
  }
  function unmount() {
    blur();
    for (const cleanup of cleanups) cleanup();
    for (const ref of refs) if (ref.current === video || ref.current === canvas) ref.current = null;
  }
  return {
    click, unmount, blur, focus, gum, models, states, refs, frames, video, canvas, defaultEngine,
    hide() { document.hidden = true; document.visibilityState = 'hidden'; document.dispatch('visibilitychange'); },
    show() { document.hidden = false; document.visibilityState = 'visible'; document.dispatch('visibilitychange'); },
    pagehide() { window.dispatch('pagehide'); },
    pageshow() { window.dispatch('pageshow'); },
    frame(now = 100) {
      const [id, callback] = frames.entries().next().value || [];
      assert(callback, 'no scheduled RAF callback');
      frames.delete(id);
      callback(now);
    },
    get status() { return states[0].value; },
    get engineCalls() { return engineCalls; },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function readyCamera(h) {
  const task = h.click('mv-start-camera');
  const stream = fakeStream('ready');
  h.gum.at(-1).resolve(stream);
  await task;
  assert.equal(h.status, 'camera');
  assert.equal(h.frames.size, 1);
  return stream;
}
function manualTapWorks(h) {
  h.click('mv-manual');
  assert.equal(h.status, 'manual');
  h.click('mv-plus');
  assert.equal(h.refs[0].current.snapshot.mode, 'manual');
  assert.equal(h.refs[0].current.snapshot.reps, 1);
  assert.equal(h.frames.size, 0);
}

// Original five desired-behavior regressions remain a separate comparison group.
const original = [
  ['late permission after Stop stays stopped', async () => {
    const h = harness(); const task = h.click('mv-start-camera');
    assert.equal(h.status, 'starting'); h.click('mv-stop');
    const stream = fakeStream('late'); h.gum[0].resolve(stream); await task;
    assert.equal(h.status, 'idle'); assert.equal(stream.track.stops, 1); assert.equal(h.frames.size, 0);
  }],
  ['late permission after manual stays manual', async () => {
    const h = harness(); const task = h.click('mv-start-camera'); h.click('mv-manual');
    const stream = fakeStream('late'); h.gum[0].resolve(stream); await task;
    assert.equal(h.status, 'manual'); assert.equal(stream.track.stops, 1); assert.equal(h.frames.size, 0);
    assert.equal(h.refs[0].current.snapshot.mode, 'manual');
  }],
  ['late permission after unmount closes stream safely', async () => {
    const h = harness(); const task = h.click('mv-start-camera'); h.unmount();
    const stream = fakeStream('late'); h.gum[0].resolve(stream); await task;
    assert.equal(stream.track.stops, 1); assert.equal(h.frames.size, 0);
  }],
  ['late model after unmount is closed and cannot start RAF', async () => {
    const h = harness(); const model = deferred(); h.models.push(model);
    const task = h.click('mv-start-camera'); const stream = fakeStream('model');
    h.gum[0].resolve(stream); await settle(); assert.equal(h.engineCalls, 1); h.unmount();
    model.resolve(h.defaultEngine); await task;
    assert.equal(h.defaultEngine.closes, 1); assert.equal(h.frames.size, 0); assert.equal(stream.track.stops, 1);
  }],
  ['concurrent starts plus Stop leave no stream or loop', async () => {
    const h = harness(); const a = h.click('mv-start-camera'); const b = h.click('mv-start-camera');
    const sa = fakeStream('A'), sb = fakeStream('B');
    h.gum[0].resolve(sa); await a; h.gum[1].resolve(sb); await b;
    assert.equal(h.frames.size, 1); h.click('mv-stop');
    assert.equal(sa.track.stops, 1); assert.equal(sb.track.stops, 1); assert.equal(h.frames.size, 0);
  }],
];

const navigation = [
  ['route blur during permission cancels; refocus cannot reopen', async () => {
    const h = harness(); const task = h.click('mv-start-camera'); h.blur();
    const stream = fakeStream('late blur'); h.gum[0].resolve(stream); await task;
    assert.equal(h.status, 'idle'); assert.equal(stream.track.stops, 1); assert.equal(h.frames.size, 0);
    h.focus(); await settle(); assert.equal(h.gum.length, 1); assert.equal(h.frames.size, 0);
  }],
  ['route blur while active closes resources; blurred start/refocus cannot reopen', async () => {
    const h = harness(); const stream = await readyCamera(h); h.blur();
    assert.equal(stream.track.stops, 1); assert.equal(h.defaultEngine.closes, 1); assert.equal(h.frames.size, 0);
    await h.click('mv-start-camera'); assert.equal(h.gum.length, 1);
    h.focus(); await settle(); assert.equal(h.gum.length, 1); assert.equal(h.frames.size, 0);
  }],
  ['hidden page during permission cancels; visible again cannot reopen', async () => {
    const h = harness(); const task = h.click('mv-start-camera'); h.hide();
    const stream = fakeStream('late hidden'); h.gum[0].resolve(stream); await task;
    assert.equal(h.status, 'idle'); assert.equal(stream.track.stops, 1); assert.equal(h.frames.size, 0);
    h.show(); await settle(); assert.equal(h.gum.length, 1); assert.equal(h.frames.size, 0);
  }],
  ['pagehide during model load closes late model; pageshow cannot reopen', async () => {
    const h = harness(); const model = deferred(); h.models.push(model);
    const task = h.click('mv-start-camera'); const stream = fakeStream('late model');
    h.gum[0].resolve(stream); await settle(); assert.equal(h.engineCalls, 1); h.pagehide();
    model.resolve(h.defaultEngine); await task;
    assert.equal(stream.track.stops, 1); assert.equal(h.defaultEngine.closes, 1); assert.equal(h.frames.size, 0);
    h.pageshow(); await settle(); assert.equal(h.gum.length, 1); assert.equal(h.frames.size, 0);
  }],
  ['pagehide while active closes resources; pageshow cannot reopen', async () => {
    const h = harness(); const stream = await readyCamera(h); h.pagehide();
    assert.equal(stream.track.stops, 1); assert.equal(h.defaultEngine.closes, 1); assert.equal(h.frames.size, 0);
    h.pageshow(); await settle(); assert.equal(h.gum.length, 1); assert.equal(h.frames.size, 0);
  }],
  ['hidden page stops synthetic RAF; visible again cannot restart it', async () => {
    const h = harness(); h.click('mv-start-synthetic'); assert.equal(h.frames.size, 1); h.hide();
    assert.equal(h.status, 'idle'); assert.equal(h.frames.size, 0); h.show(); await settle();
    assert.equal(h.frames.size, 0); assert.equal(h.gum.length, 0);
  }],
];

// Permission/model failures are preservation controls; they also pass on accepted source.
const failures = [
  ['permission refusal leaves visible Manual and plus controls usable', async () => {
    const h = harness(); const task = h.click('mv-start-camera');
    h.gum[0].reject(Object.assign(new Error('permission refused'), { name: 'NotAllowedError' }));
    await task; assert.equal(h.status, 'denied'); manualTapWorks(h);
  }],
  ['model failure releases stream and leaves Manual plus control usable', async () => {
    const h = harness(); const model = deferred(); h.models.push(model);
    const task = h.click('mv-start-camera'); const stream = fakeStream('model failure');
    h.gum[0].resolve(stream); await settle(); model.reject(new Error('model failed')); await task;
    assert.equal(h.status, 'error'); assert.equal(stream.track.stops, 1); manualTapWorks(h);
  }],
  ['inference failure releases resources and leaves Manual plus control usable', async () => {
    const h = harness(); h.defaultEngine.estimate = () => { throw new Error('inference failed'); };
    const stream = await readyCamera(h); h.frame();
    assert.equal(h.status, 'error'); assert.equal(stream.track.stops, 1); assert.equal(h.defaultEngine.closes, 1);
    manualTapWorks(h);
  }],
];

async function main() {
  const groups = {};
  for (const [group, checks] of [['originalFive', original], ['focusAndPage', navigation], ['failureAndManual', failures]]) {
    let failed = 0;
    for (const [label, check] of checks) {
      try { await check(); console.log('PASS [' + group + '] ' + label); }
      catch (error) { failed++; console.log('FAIL [' + group + '] ' + label + ': ' + error.message); }
    }
    groups[group] = { passed: checks.length - failed, failed, total: checks.length };
  }
  const passed = Object.values(groups).reduce((n, group) => n + group.passed, 0);
  const failed = Object.values(groups).reduce((n, group) => n + group.failed, 0);
  console.log(JSON.stringify({
    source: BASE, groups, passed, failed,
    proof: 'exact component source with mocked hooks, focus, DOM, estimator and RAF; no browser or camera',
  }));
  process.exitCode = failed ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
