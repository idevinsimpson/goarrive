import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import * as sessionTiming from '../../../apps/goarrive/lib/sessionTiming';
import * as workoutReturnPath from '../../../apps/goarrive/lib/workoutReturnPath';

// Execute the actual screen with retained hook slots to model Expo reusing a
// mounted dynamic-route component. No Firebase/network calls are made.
function screenHarness() {
  let route = 'A', cursor = 0;
  const slots: any[] = [], effects: Array<() => void> = [];
  const pending: Record<string, { reject: (error: Error) => void }> = {};
  const user = { uid: 'member' };
  const react: any = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef: (initial: any) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useMemo: (fn: any) => { cursor++; return fn(); },
    useCallback: (fn: any) => { cursor++; return fn; },
    useEffect: (fn: any, deps: any[]) => { const i = cursor++, old = slots[i]; if (!old || deps.some((d, n) => d !== old.deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  react.default = react;
  const native: any = { Platform: { OS: 'web' }, StyleSheet: { create: (v: any) => v }, Alert: { alert: jest.fn() } };
  for (const name of ['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View']) native[name] = name;
  const modules: Record<string, any> = {
    react,
    'react-native': native,
    'expo-router': { useLocalSearchParams: () => ({ sessionInstanceId: route }), useRouter: () => ({}), Redirect: 'Redirect' },
    'firebase/firestore': { doc: (_: any, __: any, id: string) => id, onSnapshot: (id: string, next: any) => { next({ id, exists: () => true, data: () => ({ status: 'scheduled', playbookId: 'plan', playbookTitle: id, scheduledDate: '2099-01-01', scheduledStartTime: '12:00', timezone: 'UTC', startUtc: { toMillis: () => Date.now() + 7200000 }, durationMinutes: 45 }) }); return () => {}; } },
    'firebase/functions': { httpsCallable: (_: any, name: string) => ({ instanceId }: any) => { if (name !== 'cancelInstance') throw Error(name); return new Promise((_, reject) => { pending[instanceId] = { reject }; }); } },
    '../../lib/AuthContext': { useAuth: () => ({ user, loading: false }) },
    '../../lib/firebase': { db: {}, functions: {} },
    '../../lib/theme': {},
    '../../lib/sessionTiming': sessionTiming,
    '../../lib/workoutReturnPath': workoutReturnPath,
    '../../hooks/useSessionServerTime': { useSessionServerTime: () => ({ now: Date.now(), refreshTime: () => {} }) },
    '../../components/WorkoutPlayer': { default: 'WorkoutPlayer' },
    '../../components/WorkoutVideoOverlay': { default: 'WorkoutVideoOverlay' },
    '../../components/SessionZoomTile': { default: 'SessionZoomTile' },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../apps/goarrive/app/live-session/[sessionInstanceId].tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const scope: any = { exports: {}, require: (id: string) => { if (!(id in modules)) throw Error(id); return modules[id]; }, window: { confirm: () => true }, console, Date, Intl, setInterval: () => 0, clearInterval: () => {} };
  vm.runInNewContext(js, scope);
  function render(): any { let tree; for (let n = 0; n < 3; n++) { cursor = 0; tree = scope.exports.default(); while (effects.length) effects.shift()!(); } return tree; }
  function nodes(tree: any): any[] { if (!tree || typeof tree !== 'object') return []; return [tree, ...(tree.props?.children || []).flat(Infinity).flatMap(nodes)]; }
  function text(tree: any): string { if (typeof tree === 'string') return tree; return (tree?.props?.children || []).flat(Infinity).map(text).join(''); }
  return {
    navigate: (id: string) => { route = id; render(); },
    cancel: () => { const button = nodes(render()).find(n => n.type === 'Pressable' && text(n) === 'Cancel Session'); if (!button) throw Error('Cancel button missing'); button.props.onPress(); },
    reject: async (id: string) => { pending[id].reject(new Error(`Rejected ${id}`)); await Promise.resolve(); await Promise.resolve(); },
    text: () => text(render()),
  };
}

test('delayed cancellation rejection cannot write A error or clear B pending state on reused route', async () => {
  const h = screenHarness(); h.cancel(); h.navigate('B'); h.cancel();
  await h.reject('A');
  expect(h.text()).not.toContain('Rejected A');
  expect(h.text()).toContain('Cancelling');
  await h.reject('B');
  expect(h.text()).toContain('Rejected B');
  expect(h.text()).toContain('Cancel Session');
});
