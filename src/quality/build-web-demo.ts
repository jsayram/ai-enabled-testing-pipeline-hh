import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { scenarios } from '../app/checkout.ts';
import { decide, releasePolicyVersion, selectChecks } from './policy.ts';
import type { CheckResult } from './policy.ts';
import type { Replay } from '../../web/replay.ts';
import { verifyReleaseReport } from './release-report.ts';
import { writeJson } from './io.ts';

const { values } = parseArgs({ options: { matrix: { type: 'string' }, outage: { type: 'string' } } });
const snapshot = 'docs/evidence/release-replay.json';
async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function capture(directory: string, id: string, expectedScenario = id): Promise<Replay> {
  const verification = await verifyReleaseReport(directory);
  const report = await readJson<{
    scenario: string; changedPaths: string[] | null; results: CheckResult[];
    advisory: { mode: string; reason?: string };
  }>(join(directory, 'release.json'));
  assert.equal(report.scenario, expectedScenario);
  const outage = id === 'provider-outage';
  if (outage) {
    assert.equal(report.advisory.mode, 'fallback');
    assert.equal(report.advisory.reason, 'model-unavailable');
    assert.equal(verification.decision, 'BLOCK');
  }
  return {
    id, changedPaths: report.changedPaths,
    results: report.results.map(({ id, status, summary, durationMs }) => ({ id, status, summary, durationMs })),
    recordedDecision: verification.decision, verifiedFiles: verification.verifiedFiles.length,
    advisory: outage ? 'model-unavailable' : 'recorded-checks',
  };
}

if (values.matrix || values.outage) {
  if (!values.matrix || !values.outage) throw new Error('Pass both --matrix and --outage to refresh the snapshot.');
  const replays = await Promise.all([
    ...scenarios.map(id => capture(join(values.matrix!, id), id)),
    capture(values.outage, 'provider-outage', 'eval-regression'),
  ]);
  await writeJson(snapshot, { policyVersion: releasePolicyVersion, replays });
}

const evidence = await readJson<{ policyVersion: string; replays: Replay[] }>(snapshot);
assert.equal(evidence.policyVersion, releasePolicyVersion, 'Refresh recorded evidence after changing the policy version.');
assert.deepEqual(evidence.replays.map(replay => replay.id), [...scenarios, 'provider-outage']);
for (const replay of evidence.replays) {
  const verdict = decide(selectChecks(replay.changedPaths).selected, replay.results);
  assert.equal(verdict.decision, replay.recordedDecision, 'Recorded evidence differs from replay for ' + replay.id);
}

const output = 'dist/demo';
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'styles.css']) await copyFile(join('web', file), join(output, file));
for (const source of ['web/replay.ts', 'src/quality/policy.ts']) {
  const result = ts.transpileModule(await readFile(source, 'utf8'), {
    fileName: source,
    compilerOptions: {
      target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true,
    },
  });
  const file = join(output, source.replace(/\.ts$/, '.js'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, result.outputText);
}
await copyFile(snapshot, join(output, 'evidence.json'));
await copyFile('docs/evidence/ai-reliability/report.json', join(output, 'benchmark.json'));
console.log('Static demo built in ' + output);
