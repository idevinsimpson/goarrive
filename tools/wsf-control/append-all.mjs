/** Appending a batch of writer lines through append.mjs (shared by the shadow run and the Step-6 router). */
import { appendEvent, Refused } from './append.mjs';
import { reduce } from './reduce.mjs';
import { GENESIS } from './schema.mjs';

/** Append lines one by one; a refused line is reported and skipped, never forced. Returns the new texts and a report. */
export function appendAll(eventsText, lines) {
  let text = eventsText;
  let state = text ? reduce(text) : null;
  const report = { appended: [], noop: 0, refused: [] };
  for (const { event, label } of lines) {
    try {
      const r = appendEvent(text, event, { expectHead: state?.ledgerHead ?? GENESIS });
      if (r.noop) { report.noop += 1; continue; }
      text = r.eventsText; state = r.state;
      report.appended.push(`${event.type}:${event.authority.rule}${label ? `:${label}` : ''}`);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      report.refused.push({ label: label ?? event.type, reason: e.message });
    }
  }
  return { eventsText: text, state, report };
}
