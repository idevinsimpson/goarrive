const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the generated worker, not a duplicate implementation. The generator
// runs only in a disposable fixture directory; no app build or network is used.
function generatedWorker() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'goarrive-reset-sw-'));
  try {
    const scripts = path.join(fixture, 'scripts');
    const dist = path.join(fixture, 'apps', 'goarrive', 'dist');
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(path.join(dist, 'reset-password'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'generate_sw.js'), path.join(scripts, 'generate_sw.js'));
    for (const name of ['index.html', 'bundle.js', 'reset-password.html', 'reset-password/index.html', '(auth)/reset-password.html', '(auth)/reset-password/index.html', '%28auth%29/reset-password.html']) {
      fs.mkdirSync(path.dirname(path.join(dist, name)), { recursive: true });
      fs.writeFileSync(path.join(dist, name), '<!-- synthetic test fixture -->');
    }
    execFileSync(process.execPath, [path.join(scripts, 'generate_sw.js')], { stdio: 'pipe' });
    return fs.readFileSync(path.join(dist, 'service-worker.js'), 'utf8');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

const sources = {
  generated: generatedWorker(),
  public: fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'goarrive', 'public', 'service-worker.js'), 'utf8'),
};

function worker(source) {
  const handlers = {};
  const calls = { fetch: [], open: [], match: [], put: [], add: [], deleted: [], logs: [] };
  const response = { ok: true, clone: () => response };
  const cache = {
    add: async (url) => calls.add.push(url),
    addAll: async (urls) => calls.add.push(...urls),
    put: async (...args) => calls.put.push(args),
  };
  const context = {
    URL,
    self: {
      addEventListener: (name, handler) => { handlers[name] = handler; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: async (name) => { calls.open.push(name); return cache; },
      match: async (request) => { calls.match.push(request); return undefined; },
      keys: async () => ['goarrive-20260401-141500', calls.open[0]].filter(Boolean),
      delete: async (name) => { calls.deleted.push(name); return true; },
    },
    fetch: async (request) => { calls.fetch.push(request); return response; },
    console: {
      log: (...args) => calls.logs.push(args),
      warn: (...args) => calls.logs.push(args),
    },
  };
  vm.runInNewContext(source, context);
  // Exclude the fixed startup log from per-request assertions.
  calls.logs.length = 0;
  return { handlers, calls };
}

for (const [kind, source] of Object.entries(sources)) {
test(`${kind}: reset HTML is excluded from the static pre-cache`, async () => {
  const { handlers, calls } = worker(source);
  let install;
  handlers.install({ waitUntil: (promise) => { install = promise; } });
  await install;
  assert.deepEqual(calls.add.sort(), kind === 'generated'
    ? ['/bundle.js', '/index.html']
    : ['/', '/index.html', '/manifest.json']);
});

test(`${kind}: activation removes the previous cache generation`, async () => {
  const { handlers, calls } = worker(source);
  let installing;
  handlers.install({ waitUntil: (promise) => { installing = promise; } });
  await installing;
  assert.notEqual(calls.open[0], 'goarrive-20260401-141500');
  let activating;
  handlers.activate({ waitUntil: (promise) => { activating = promise; } });
  await activating;
  assert.deepEqual(calls.deleted, ['goarrive-20260401-141500']);
});

for (const suffix of [
  '/reset-password',
  '/reset-password/',
  '/reset-password.html',
  '/reset-password/index.html',
  '/(auth)/reset-password',
  '/(auth)/reset-password/',
  '/(auth)/reset-password.html',
  '/(auth)/reset-password/index.html',
  '/%28auth%29/reset-password',
  '/%28auth%29/reset-password.html',
  '/reset-password?mode=resetPassword&oobCode=synthetic-code-not-valid',
  '/anywhere?oobCode=synthetic-code-not-valid',
  '/anywhere?oobCode=',
  '/__/auth/action?mode=resetPassword',
  '/__/auth/handler',
]) {
  test(`${kind}: sensitive action request bypasses all service-worker handling: ${suffix.split('?')[0]}`, () => {
    const { handlers, calls } = worker(source);
    let intercepted = false;
    handlers.fetch({
      request: {
        url: `https://example.test${suffix}`,
        method: 'GET',
        headers: { get: () => 'text/html' },
      },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false);
    assert.deepEqual(calls, { fetch: [], open: [], match: [], put: [], add: [], deleted: [], logs: [] });
  });
}

for (const ordinaryPath of ['/login', '/(auth)/login']) {
test(`${kind}: ordinary HTML retains network-first caching: ${ordinaryPath}`, async () => {
  const { handlers, calls } = worker(source);
  const request = {
    url: `https://example.test${ordinaryPath}`,
    method: 'GET',
    headers: { get: () => 'text/html' },
  };
  let result;
  handlers.fetch({ request, respondWith: (promise) => { result = promise; } });
  assert.ok(result);
  await result;
  assert.deepEqual(calls.fetch, [request]);
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0][0], request);
});
}
}
