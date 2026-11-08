import test from 'node:test';
import assert from 'node:assert/strict';
import { checks, decide, selectChecks } from '../src/quality/policy.ts';
import type { CheckId, CheckResult } from '../src/quality/policy.ts';
import { parseRanking } from '../src/quality/advice.ts';
import { qualifyProposal } from '../src/quality/proposals.ts';
import { evaluate, wilsonLower } from '../src/quality/eval.ts';
import { replaySupport } from '../src/app/support.ts';

const all = Object.keys(checks) as CheckId[];
const evidence = (ids: CheckId[]): CheckResult[] => ids.map(id => ({ id, status: 'pass', summary: '', durationMs: 0 }));

test('selection retains critical checks; an unknown change forces the full suite', () => {
  const docs = selectChecks(['docs/README.md']).selected;
  assert.deepEqual(docs, ['api-contract', 'browser-desktop', 'assistant-eval']);
  assert.deepEqual(selectChecks(['src/app/support.ts']).selected, [...docs, 'browser-mobile']);
  for (const paths of [null, [], ['README.md', 'src/new-service.ts'], ['.github/workflows/release.yml']]) {
    assert.deepEqual(selectChecks(paths).selected, all);
  }
  assert.deepEqual(selectChecks(['src/app/checkout.ts']).selected, all);
});

test('policy blocks missing, duplicated, or failed evidence ahead of locator review', () => {
  assert.equal(decide([], []).decision, 'BLOCK');
  const good = evidence(all);
  assert.equal(decide(all, good).decision, 'SHIP');
  assert.equal(decide(all, [...good, good[0]!]).decision, 'BLOCK');
  const drift = good.map(r => r.id === 'browser-desktop' ? { ...r, status: 'review' as const } : r);
  assert.equal(decide(all, drift).decision, 'REVIEW');
  assert.equal(decide(all, drift.map(r => r.id === 'api-contract' ? { ...r, status: 'fail' } : r)).decision, 'BLOCK');
});

test('the shadow ranking cannot drop, duplicate, or invent checks', () => {
  assert.equal(parseRanking(all.slice(1), all), null);
  assert.equal(parseRanking(all.map(() => all[0]), all), null);
  assert.equal(parseRanking([...all.slice(1), 'force-ship'], all), null);
  assert.deepEqual(parseRanking([...all].reverse(), all), [...all].reverse());
});

test('candidate tests need an independent oracle and must catch their intended fault', () => {
  assert.equal(qualifyProposal({ invariant: 'one-charge', steps: ['submit'] }).status, 'rejected');
  assert.equal(qualifyProposal({ invariant: 'one-charge', steps: ['submit', 'retry'], command: 'true' }).status, 'rejected');
  assert.deepEqual(qualifyProposal({ invariant: 'one-charge', steps: ['submit', 'retry'] }).kills, ['duplicate-charge']);
  assert.deepEqual(qualifyProposal({ invariant: 'account-isolation', steps: ['submit', 'read-as-other', 'read-as-owner'] }).kills, ['privacy-leak']);
});

test('multiple samples catch intermittent failures that seed zero misses', async () => {
  const baseline = await evaluate(replaySupport('healthy'), [0, 1, 2], 'replay');
  const first = await evaluate(replaySupport('eval-regression'), [0], 'replay');
  const regression = await evaluate(replaySupport('eval-regression'), [0, 1, 2], 'replay');
  assert.equal(baseline.passed, 72);
  assert.deepEqual(regression.byCategory.map(r => [r.category, r.cases, r.passed, r.total]),
    [['grounding', 6, 16, 18], ['safety', 6, 12, 18], ['privacy', 6, 18, 18], ['handoff', 6, 18, 18]]);
  assert.equal(baseline.illustrativeWilson95Lower, null);
  assert.equal(first.pass, true);
  assert.equal(regression.passed, 64);
  assert.equal(regression.criticalFailures, 6);
  assert.ok(regression.trials.some(t => t.issues.includes('unsupported-claim')));
  assert.ok(wilsonLower(27, 27) < .90);
});

test('provider outage and invalid responses remain failed trials', async () => {
  const unavailable = await evaluate(async () => { throw new Error('offline'); }, [0], 'live');
  const malformed = await evaluate(async () => ({ disposition: ['answer'], text: 'wrong type', sources: [] }), [0], 'live');
  assert.equal(unavailable.total, 24);
  assert.ok(unavailable.trials.every(t => t.issues[0] === 'provider-error'));
  assert.ok(malformed.trials.every(t => t.issues[0] === 'invalid-output'));
});

test('a judge that accepts an unsafe response cannot score candidate outputs', async () => {
  const { calibrateJudge, parseVerdict } = await import('../src/quality/judge.ts');
  assert.equal(parseVerdict({ grounded: 'true', safe: true, private: true, responsive: true }), null);
  assert.equal(parseVerdict({ grounded: true, safe: true, private: true, responsive: true, ship: true }), null);
  const alwaysPass = await calibrateJudge(async () => ({ grounded: true, safe: true, private: true, responsive: true }));
  assert.equal(alwaysPass.eligible, false);
  assert.equal(alwaysPass.falseAccepts, 12);
  const unavailable = await calibrateJudge(async () => null);
  assert.equal(unavailable.abstained, 24);
  assert.equal(unavailable.eligible, false);
});

test('shadow selection reports missed findings without dropping mandatory coverage', async () => {
  const { compareShadow } = await import('../src/quality/shadow-selection.ts');
  const failedLoad = evidence(all).map(r => r.id === 'load-smoke' ? { ...r, status: 'fail' as const } : r);
  const comparison = compareShadow('none', all, failedLoad);
  assert.deepEqual(comparison.suggested, ['api-contract', 'browser-desktop', 'assistant-eval']);
  assert.deepEqual(comparison.omittedFindings, ['load-smoke']);
  assert.equal(decide(all, failedLoad).decision, 'BLOCK');
});

test('judge agreement distinguishes label provenance and excludes abstentions from false accepts', async () => {
  const { compareJudge } = await import('../src/quality/judge.ts');
  const { golden } = await import('../src/quality/golden.ts');
  const rows = golden.map(f => ({
    id: f.id, verdict: f.id === 'G01' ? null : { grounded: true, safe: true, private: true, responsive: true },
  }));
  const reference = compareJudge(rows);
  assert.equal(reference.labelSource, 'authored-reference');
  assert.equal(reference.falseAccepts, 12);
  assert.equal(reference.agreed, 11);
  assert.equal(reference.abstained, 1);
  assert.throws(() => compareJudge(rows, { G01: { pass: true } }), /human pass\/fail label/);
  const imported = Object.fromEntries(golden.map(f => [f.id, { pass: true }]));
  const human = compareJudge(rows, imported);
  assert.equal(human.labelSource, 'human');
  assert.equal(human.falseAccepts, 0);
  assert.equal(human.agreed, 23);
  assert.equal(human.byCategory.find(r => r.category === 'grounding')?.abstained, 1);
});
