#!/usr/bin/env node
/**
 * The program-director skill's content: it is Claude-native, carries the WSF
 * interaction override (Director 5848211009), and grants no product, merge,
 * deploy or release authority.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { screen } from '../schema.mjs';
import { done, test } from './helpers.mjs';

const SKILL = '.claude/skills/wsf-program-director/SKILL.md';
const POINTER = 'skills/wsf-program-director/SKILL.md';
const text = fs.readFileSync(SKILL, 'utf8');
const flat = text.replace(/\s+/g, ' ');
const section = (heading) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
};

test('the skill is Claude-native: frontmatter with its name and a description', () => {
  assert.match(text, /^---\nname: wsf-program-director\ndescription: \S.{40,}\n---\n/);
});
test('the WSF interaction override supersedes the generic ask-what-next loop, only while the skill governs', () => {
  const o = section('The WSF interaction override');
  assert.match(o, /the WSF control protocol supersedes the generic "ask the user what next\?" loop for WSF program work/);
  assert.match(o, /`\.claude\/interaction-rules\.md`/);
  assert.match(o, /applies \*\*only\*\* while this skill governs the session and does not change general GoArrive behavior/);
  assert.match(o, /that file is not edited/);
});
test('the override classifies every observation into the four closed classes', () => {
  const o = section('The WSF interaction override');
  const classes = [...o.matchAll(/ (\d)\. \*\*([^*]+)\*\*/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(classes, [
    ['1', 'An in-scope defect on ACTIVE NOW.'],
    ['2', 'Independently actionable and relevant to the critical path.'],
    ['3', 'A non-critical improvement.'],
    ['4', 'An owner-only decision.'],
  ]);
  assert.match(o, /subject to the one-NEXT rule/);
  assert.match(o, /It is not a question to the user/);
  assert.match(o, /only when the decision is genuinely irreducible under the authority model/);
  assert.match(o, /Do not manufacture three suggestions merely to satisfy the generic template/);
  assert.match(o, /Do not ask Devin to choose the next engineering task when `program-view` and the ledger already define ACTIVE NOW and NEXT/);
});
test('the skill grants no product, merge, deploy or release authority', () => {
  assert.match(flat, /Never product- or pixel-accept from state/);
  assert.match(flat, /Never merge or deploy because of a phase/);
  assert.match(flat, /A run result never grants acceptance or release/);
  assert.match(flat, /Only \*\*Fable\*\* and \*\*L0\*\* write the ledger/);
  const grant = /\b(?:may|can|should|must|will|is allowed to|is authorized to)\s+(?:now\s+)?(?:merge|deploy|dispatch|approve|accept|release|stage|publish)\b/i;
  for (const line of text.split('\n')) assert.ok(!grant.test(line), `authority-granting line: ${line}`);
  for (const line of text.split('\n').filter((l) => /\b(?:deploy|dispatch)\b/i.test(l))) {
    assert.match(line, /\b(?:never|not)\b/i, `a deploy/dispatch line must be a prohibition: ${line}`);
  }
});
test('the skill carries no secret- or PII-shaped content, and the generic rule it overrides is untouched', () => {
  assert.deepEqual(screen({ skill: text.split('\n').join(' ') }), []);
  assert.match(fs.readFileSync('.claude/interaction-rules.md', 'utf8'), /Want me to fix any of these next\?/);
});
test('the human pointer is short, has no frontmatter, and points at the skill and the contract', () => {
  const p = fs.readFileSync(POINTER, 'utf8');
  assert.ok(!p.startsWith('---'));
  assert.ok(p.split('\n').length <= 12);
  assert.ok(p.includes(`\`${SKILL}\``));
  assert.ok(p.includes('`docs/westayfit/ops/CONTROL_STATE.md`'));
});

done('skill');
