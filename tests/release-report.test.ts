import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson } from '../src/quality/io.ts';
import { decide, releasePolicyVersion, selectChecks } from '../src/quality/policy.ts';
import type { CheckResult } from '../src/quality/policy.ts';
import { evidenceDigests, verifyReleaseReport } from '../src/quality/release-report.ts';

test('report verification rejects forged verdicts, source revisions, and changed primary evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'release-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const changedPaths = ['README.md'];
  const plan = selectChecks(changedPaths);
  const results: CheckResult[] = plan.selected.map(id => ({
    id, status: id === 'assistant-eval' ? 'fail' : 'pass', summary: '', durationMs: 1,
  }));
  await writeFile(join(directory, 'assistant-eval.json'), '{"passed":64}');
  await writeFile(join(directory, 'playwright-desktop.json'), '{"passed":2}');
  const report = {
    schema: 2, policyVersion: releasePolicyVersion, commit: 'a'.repeat(40), changedPaths, plan, results,
    evidenceDigests: await evidenceDigests(directory), ...decide(plan.selected, results),
    advisory: { decision: 'SHIP' },
  };
  const file = join(directory, 'release.json');
  await writeJson(file, report);
  assert.equal((await verifyReleaseReport(directory, report.commit)).decision, 'BLOCK');
  await assert.rejects(verifyReleaseReport(directory, 'b'.repeat(40)), /expected source revision/);

  await writeJson(file, { ...report, decision: 'SHIP' });
  await assert.rejects(verifyReleaseReport(directory), /verdict differs/);
  await writeJson(file, { ...report, plan: { selected: [] } });
  await assert.rejects(verifyReleaseReport(directory), /check plan differs/);

  await writeJson(file, report);
  await writeFile(join(directory, 'assistant-eval.json'), '{"passed":72}');
  await assert.rejects(verifyReleaseReport(directory), /digests do not match/);
});
