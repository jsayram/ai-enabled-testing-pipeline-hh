import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenarios } from '../app/checkout.ts';
import type { Scenario } from '../app/checkout.ts';
import type { CheckId, CheckResult, Decision } from './policy.ts';
import { runProcess } from './io.ts';
import { verifyReleaseReport } from './release-report.ts';

const expected: Record<Scenario, [Decision, number, CheckId[]]> = {
  healthy: ['SHIP', 0, []],
  'selector-drift': ['REVIEW', 2, ['browser-desktop', 'browser-mobile']],
  'checkout-regression': ['BLOCK', 1, ['api-contract', 'browser-desktop', 'browser-mobile', 'load-smoke']],
  'drift-with-regression': ['BLOCK', 1, ['api-contract', 'browser-desktop', 'browser-mobile', 'load-smoke']],
  'eval-regression': ['BLOCK', 1, ['assistant-eval']],
  'duplicate-charge': ['BLOCK', 1, ['api-contract']],
  'privacy-leak': ['BLOCK', 1, ['api-contract']],
};

await mkdir('artifacts', { recursive: true });
const directory = await mkdtemp('artifacts/demo-');
const lines = ['# Fault injection results', '', '| Scenario | Expected | Actual | Findings |', '| --- | --- | --- | --- |'];
for (const scenario of scenarios) {
  const output = join(directory, scenario);
  const child = await runProcess(['src/quality/run.ts', '--scenario', scenario, '--out', output]);
  const [decision, code, findings] = expected[scenario];
  const report = JSON.parse(await readFile(join(output, 'release.json'), 'utf8')) as
    { decision: Decision; results: CheckResult[] };
  const expectedStatus = decision === 'REVIEW' ? 'review' : 'fail';
  assert.equal(report.decision, decision, child.stdout + child.stderr);
  assert.equal((await verifyReleaseReport(output)).decision, decision);
  assert.equal(child.code, code, child.stdout + child.stderr);
  assert.deepEqual(report.results.filter(r => r.status !== 'pass').map(r => [r.id, r.status]),
    findings.map(id => [id, expectedStatus]), child.stdout + child.stderr);
  lines.push('| [' + scenario + '](' + scenario + '/release.md) | ' + decision + ' | ' + report.decision + ' | ' +
    (findings.join(', ') || 'All checks passed') + ' |');
  console.log(scenario + ': ' + report.decision);
}
const reliability = await runProcess(['src/quality/verify-ai.ts', '--replay', '--out', join(directory, 'ai-reliability')]);
assert.equal(reliability.code, 0, reliability.stdout + reliability.stderr);
lines.push('', 'Each release report was verified. See the [AI reliability checks](ai-reliability/report.md) for the model boundary results.');
await writeFile(join(directory, 'comparison.md'), lines.join('\n') + '\n');
console.log('Evidence: ' + directory + '/comparison.md');
