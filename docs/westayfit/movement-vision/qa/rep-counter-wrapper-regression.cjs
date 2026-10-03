/**
 * Exact RepCounterProof component-source regression, with mocked React hooks,
 * DOM, camera permission, MediaPipe estimator, and RAF. This is not a mounted
 * React/browser/camera test and does not establish human squat accuracy.
 *
 * Usage: node rep-counter-wrapper-regression.cjs /path/to/candidate-repository
 * The selected repository source is read only. No imagery or personal data
 * is used, captured, written, or uploaded. Synthetic landmarks exist in memory.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

if (!process.argv[2]) throw new Error('Pass the candidate repository root.');
const ROOT = path.resolve(process.argv[2]);
const SOURCE = path.join(ROOT, 'src/lab/rep-counter-proof');
const ts = createRequire(path.join(ROOT, 'package.json'))('typescript');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function target(initial = {}) {
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

function harness() {
  const refs = [], states = [], effects = [], streams = [], estimators = [];
  const frames = new Map();
  let refIndex = 0, stateIndex = 0, frameId = 0, rendered = false, tree;
  let depth = 0, makePose;
  const location = {
    origin: 'https://counter.invalid', href: 'https://counter.invalid/lab/rep-counter-proof',
    pathname: '/lab/rep-counter-proof', search: '',
  };
  const document = target({ visibilityState: 'visible', hidden: false });
  const window = target({ location });
  const video = target({
    srcObject: null, readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480,
    error: null, play: async () => {}, pause() {},
  });
  function createStream() {
    const track = target({
      readyState: 'live', kind: 'video', stops: 0,
      stop() { this.stops++; this.readyState = 'ended'; },
    });
    const stream = { track, getTracks: () => [track], getVideoTracks: () => [track] };
    streams.push(stream);
    return stream;
  }
  const react = {
    useRef(value) {
      const i = refIndex++;
      if (!refs[i]) refs[i] = { current: value };
      return refs[i];
    },
    useState(value) {
      const i = stateIndex++;
      if (!states[i]) states[i] = { value: typeof value === 'function' ? value() : value };
      return [states[i].value, (next) => {
        states[i].value = typeof next === 'function' ? next(states[i].value) : next;
      }];
    },
    useCallback: (fn) => fn,
    useEffect(fn) {
      // Source dependencies are constant during these explicit mock rerenders.
      if (!rendered) effects.push(fn());
    },
  };
  const jsx = (type, props) => ({ type, props: props || {} });
  const stubs = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@tanstack/react-router': { Link: 'a' },
    '@/assets/wordmark-white.png.asset.json': { __esModule: true, default: { url: 'about:blank' } },
    './mediapipeVite': {
      createMediaPipeEstimator: async () => {
        const estimator = {
          engine: 'synthetic audit estimator', maxPoses: 3, closes: 0,
          close() { this.closes++; },
          estimate(_video, timestampMs) {
            return { timestampMs, aspect: 640 / 480, poses: [makePose(depth)] };
          },
        };
        estimators.push(estimator);
        return estimator;
      },
    },
  };
  const context = vm.createContext({
    console, process, setTimeout, clearTimeout, URLSearchParams, document, window, location,
    performance: { now: () => 0 },
    navigator: { mediaDevices: { getUserMedia: async () => createStream() } },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const execute = vm.runInContext('(function(require,module,exports){' + js + '\n})', context, { filename: file });
    execute((id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id.startsWith('.')) {
        const base = path.resolve(path.dirname(file), id);
        return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx');
      }
      throw new Error('Unmocked external import: ' + id);
    }, module, module.exports);
    return module.exports;
  }
  const { syntheticPose } = load(path.join(SOURCE, 'core/synthetic.ts'));
  makePose = (d) => syntheticPose({ cx: 0.5, footY: 0.92, height: 0.7, depth: d });
  const Component = load(path.join(SOURCE, 'RepCounterProof.tsx')).RepCounterProof;
  function visit(node, fn) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach((child) => visit(child, fn));
    if (typeof node !== 'object') return;
    fn(node); visit(node.props?.children, fn);
  }
  function text(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(text).join('');
    return typeof node === 'object' ? text(node.props?.children) : String(node);
  }
  function render() {
    refIndex = stateIndex = 0;
    tree = Component();
    rendered = true;
    visit(tree, (node) => { if (node.type === 'video') node.props.ref.current = video; });
  }
  function findButton(label) {
    render();
    let result;
    visit(tree, (node) => {
      if (node.type === 'button' && text(node.props.children).trim() === label) result = node;
    });
    return result;
  }
  function count() {
    render();
    let result;
    visit(tree, (node) => { if (node.props?.['data-testid'] === 'count') result = Number(text(node.props.children)); });
    assert.notEqual(result, undefined, 'The actual count element must exist.');
    return result;
  }
  render();
  return {
    streams, estimators, frames, video, findButton, count,
    click(label) {
      const button = findButton(label);
      assert(button, 'Missing button: ' + label);
      return button.props.onClick();
    },
    frame(timestampMs, nextDepth) {
      depth = nextDepth; video.currentTime += 0.05;
      const [id, callback] = frames.entries().next().value || [];
      assert(callback, 'No active RAF for frame ' + timestampMs);
      frames.delete(id); callback(timestampMs);
    },
    pagehide() { window.dispatch('pagehide'); },
    snapshot() {
      const session = refs.find((ref) => ref.current?.snapshot && typeof ref.current.update === 'function')?.current;
      assert(session, 'Actual MovementSession ref must exist.');
      return session.snapshot;
    },
    cleanup() { for (const effect of effects) if (typeof effect === 'function') effect(); },
  };
}

async function start(h) {
  h.click('Start camera');
  await settle();
  assert.equal(h.frames.size, 1);
}

const cases = [
  ['stop/start cannot complete the previous partial; fresh observed rep still counts', async () => {
    const h = harness();
    try {
      await start(h);
      for (let t = 0; t <= 1000; t += 50) h.frame(t, 0);
      for (let t = 1050; t <= 1300; t += 50) h.frame(t, 0.8);
      assert.equal(h.snapshot().phase, 'down');
      assert.equal(h.count(), 0);
      h.click('Stop');
      assert.equal(h.streams[0].track.readyState, 'ended');
      assert.equal(h.frames.size, 0);
      await start(h);
      for (let t = 1350; t <= 1500; t += 50) h.frame(t, 0);
      assert.equal(h.count(), 0, 'An unobserved old down phase became a credited local rep after restart.');
      for (let t = 1550; t <= 2250; t += 50) h.frame(t, 0);
      assert.equal(h.snapshot().phase, 'standing');
      for (let t = 2300; t <= 2600; t += 50) h.frame(t, 0.8);
      for (let t = 2650; t <= 3000; t += 50) h.frame(t, 0);
      assert.equal(h.count(), 1, 'A fully observed fresh rep must count after re-acquisition.');
    } finally { h.cleanup(); }
  }],
  ['pagehide alone stops resources and returns the actual UI to Start camera', async () => {
    const h = harness();
    try {
      await start(h);
      h.pagehide();
      assert.equal(h.streams[0].track.readyState, 'ended');
      assert.equal(h.frames.size, 0);
      assert(h.findButton('Start camera'), 'Stopped controller still has a live-stage UI after pagehide.');
      assert.equal(h.findButton('Stop'), undefined);
    } finally { h.cleanup(); }
  }],
];

async function main() {
  let failed = 0;
  for (const [name, test] of cases) {
    try { await test(); console.log('PASS ' + name); }
    catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.message); }
  }
  console.log(JSON.stringify({
    source: ROOT, passed: cases.length - failed, failed, total: cases.length,
    proof: 'Actual RepCounterProof source, actual controller and core, mocked hooks/DOM/estimator/RAF. No browser or camera proof.',
  }));
  process.exitCode = failed ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
