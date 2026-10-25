import { noShowEligible, noShowStartMs } from '../noShowTiming';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const start = Date.parse('2026-10-25T18:40:00Z');
const session = { status: 'allocated', startUtc: { seconds: start / 1000 }, scheduledDate: '2026-10-25', scheduledStartTime: '14:40', timezone: 'America/New_York' };
test('authoritative UTC start prevents the observed premature miss and respects grace boundary', () => {
  expect(noShowEligible(session, Date.parse('2026-10-25T18:30:30Z'), 15)).toBe(false);
  expect(noShowEligible(session, start + 15 * 60000 - 1, 15)).toBe(false);
  expect(noShowEligible(session, start + 15 * 60000, 15)).toBe(true);
  expect(noShowStartMs({ ...session, timezone: 'Invalid/Zone', startUtc: { toMillis: () => start } })).toBe(start);
});
test.each(['scheduled', 'pending', 'in_progress', 'completed', 'cancelled', 'missed', 'skipped', 'rescheduled'])('%s is never changed to missed', status => {
  expect(noShowEligible({ ...session, status }, start + 3600000, 15)).toBe(false);
});
test('completed workout is preserved even with stale allocated status', () => expect(noShowEligible({ ...session, workoutCompletedAt: {} }, start + 3600000, 15)).toBe(false));
test.each([
  ['2026-10-25','14:40','America/New_York','2026-10-25T18:40:00Z'],
  ['2026-10-25','14:40','UTC','2026-10-25T14:40:00Z'],
  ['2026-10-26','00:15','Asia/Kolkata','2026-10-25T18:45:00Z'],
  ['2026-11-01','01:30','America/New_York','2026-11-01T06:30:00Z'],
  ['2026-03-08','03:30','America/New_York','2026-03-08T07:30:00Z'],
])('legacy %s %s %s resolves without process timezone', (scheduledDate, scheduledStartTime, timezone, expected) => {
  expect(noShowStartMs({ scheduledDate, scheduledStartTime, timezone })).toBe(Date.parse(expected));
});
test.each([
  { scheduledDate: '2026-03-08', scheduledStartTime: '02:30', timezone: 'America/New_York' },
  { scheduledDate: '2026-02-30', scheduledStartTime: '12:00', timezone: 'UTC' },
  { scheduledDate: '2026-10-25', scheduledStartTime: '25:00', timezone: 'UTC' },
  { scheduledDate: '2026-10-25', scheduledStartTime: '12:00', timezone: 'Invalid/Zone' },
  { ...session, startUtc: { seconds: NaN } },
  { ...session, startUtc: { toMillis: () => { throw Error('bad'); } } },
  {},
])('invalid/nonexistent start fails closed: %j', value => expect(noShowStartMs(value)).toBeNull());

async function runHandler(latest: any, started = false) {
  const source = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
  const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  let callback = '';
  ast.forEachChild(node => { if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (d.name.getText(ast) === 'detectNoShows' && d.initializer && ts.isCallExpression(d.initializer)) callback = d.initializer.arguments[1].getText(ast); });
  const update = jest.fn(); const audit = jest.fn();
  const doc = { id: 'test', ref: {}, data: () => session };
  const collection = (name: string): any => ({ name, where() { return this; }, limit() { return this; }, async get() { return name === 'session_instances' ? { docs: [doc] } : { empty: true }; } });
  const db = { collection, runTransaction: async (fn: any) => fn({ get: async (ref: any) => ref === doc.ref ? { exists: true, data: () => latest } : { empty: !started }, update }) };
  jest.useFakeTimers().setSystemTime(start + 16 * 60000);
  try {
    const scope: any = { db, noShowEligible, Date, console: { log() {}, warn() {} }, FieldValue: { serverTimestamp: () => 'stamp' }, writeAuditLog: audit, result: null };
    vm.runInNewContext(ts.transpileModule(`result = (${callback})();`, { compilerOptions: { target: ts.ScriptTarget.ES2017 } }).outputText, scope);
    await scope.result; return { update, audit };
  } finally { jest.useRealTimers(); }
}
test.each(['cancelled', 'completed', 'in_progress'])('actual handler rechecks concurrent %s before writing', async status => expect((await runHandler({ ...session, status })).update).not.toHaveBeenCalled());
test('actual handler rechecks reschedule and meeting-start races', async () => {
  expect((await runHandler({ ...session, startUtc: { seconds: (start + 3600000) / 1000 } })).update).not.toHaveBeenCalled();
  expect((await runHandler(session, true)).update).not.toHaveBeenCalled();
});
test('actual handler marks a genuine no-show and audits once', async () => {
  const h = await runHandler(session); expect(h.update).toHaveBeenCalledTimes(1); expect(h.audit).toHaveBeenCalledTimes(1);
});
