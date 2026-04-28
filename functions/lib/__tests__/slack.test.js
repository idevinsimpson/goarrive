"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * slack.ts regression tests
 *
 * Locks in the contracts that broke /huddle from Marco's side:
 *   1. Maia bridge throws MaiaBridgeError on missing/empty ANTHROPIC_API_KEY
 *      (no silent degradation) — Marco's #2.
 *   2. formatHuddleTranscript only renders when the huddle actually had real
 *      Maia context (huddled=true); otherwise returns '' so the user isn't
 *      shown an empty/misleading transcript block.
 *   3. enforceMaiaHonesty scrubs fake-Maia phrases when context did NOT load,
 *      and is a no-op when it did. Trust-critical guardrail for the synth
 *      output.
 *
 * Run: cd functions && npm run test:src
 */
const slack_1 = require("../slack");
describe('getMaiaBrainReply — strict failure modes', () => {
    test('throws MaiaBridgeError(missing_key) when key is empty string', async () => {
        await expect((0, slack_1.getMaiaBrainReply)('', 'analysis', 'question', 'user msg')).rejects.toBeInstanceOf(slack_1.MaiaBridgeError);
        await expect((0, slack_1.getMaiaBrainReply)('', 'a', 'q', 'm')).rejects.toMatchObject({
            stage: 'missing_key',
        });
    });
    test('throws MaiaBridgeError(missing_key) on whitespace-only key', async () => {
        await expect((0, slack_1.getMaiaBrainReply)('   ', 'a', 'q', 'm')).rejects.toMatchObject({
            stage: 'missing_key',
        });
    });
});
describe('formatHuddleTranscript', () => {
    test('returns empty string when huddled=false (degraded — no real Maia)', () => {
        const out = (0, slack_1.formatHuddleTranscript)({
            finalReply: 'whatever',
            huddled: false,
            marcoInitial: 'marco said something',
            maiaInput: 'maia said something',
        });
        expect(out).toBe('');
    });
    test('returns empty string when both initial+input are empty', () => {
        const out = (0, slack_1.formatHuddleTranscript)({
            finalReply: 'whatever',
            huddled: true,
            marcoInitial: '',
            maiaInput: '',
        });
        expect(out).toBe('');
    });
    test('includes both sections when huddled=true with content', () => {
        const out = (0, slack_1.formatHuddleTranscript)({
            finalReply: 'synthesis',
            huddled: true,
            marcoInitial: 'marco take',
            maiaInput: 'maia take',
        });
        expect(out).toContain('Huddle transcript');
        expect(out).toContain('*Marco (initial):*');
        expect(out).toContain('marco take');
        expect(out).toContain('*Maia (real-context):*');
        expect(out).toContain('maia take');
    });
});
describe('enforceMaiaHonesty', () => {
    test('no-op when context loaded', () => {
        const reply = 'Maia said this is fine and we huddled about it.';
        expect((0, slack_1.enforceMaiaHonesty)(reply, true)).toBe(reply);
    });
    test('prepends unavailable banner when context not loaded', () => {
        const out = (0, slack_1.enforceMaiaHonesty)('some reply', false);
        expect(out.startsWith('_(Real Maia huddle unavailable')).toBe(true);
    });
    test('scrubs "Maia said" phrases when context not loaded', () => {
        const out = (0, slack_1.enforceMaiaHonesty)('Maia said the lookup is fine.', false);
        expect(out).not.toMatch(/maia said/i);
        expect(out).toMatch(/\[Marco only — real Maia unavailable\]/);
    });
    test('scrubs "we huddled" phrases when context not loaded', () => {
        const out = (0, slack_1.enforceMaiaHonesty)('We huddled with Maia and decided X.', false);
        expect(out).not.toMatch(/we huddled/i);
    });
});
//# sourceMappingURL=slack.test.js.map