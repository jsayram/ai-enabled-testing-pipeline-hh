import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checks, decide, releasePolicyVersion, selectChecks } from './policy.ts';
import type { CheckId, CheckResult } from './policy.ts';

const primaryEvidence: Partial<Record<CheckId, string>> = {
  'assistant-eval': 'assistant-eval.json',
  'browser-desktop': 'playwright-desktop.json',
  'browser-mobile': 'playwright-mobile.json',
  'load-smoke': 'load-smoke.json',
};

export async function evidenceDigests(directory: string) {
  const digests: Record<string, string> = {};
  for (const file of Object.values(primaryEvidence)) {
    try {
      const contents = await readFile(join(directory, file));
      digests[file] = createHash('sha256').update(contents).digest('hex');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return digests;
}

function isCheckResult(value: unknown): value is CheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.id === 'string' && Object.hasOwn(checks, result.id) &&
    typeof result.status === 'string' && ['pass', 'fail', 'review', 'error'].includes(result.status) &&
    typeof result.summary === 'string' && typeof result.durationMs === 'number' &&
    Number.isFinite(result.durationMs) && result.durationMs >= 0;
}

export async function verifyReleaseReport(directory: string, expectedCommit?: string) {
  const report = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8')) as Record<string, unknown>;
  if (report?.schema !== 2 || report.policyVersion !== releasePolicyVersion) {
    throw new Error('Unsupported report schema or policy version. Run the matching release gate.');
  }
  const commit = report.commit;
  if (!(commit === null || (typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit))) ||
      (expectedCommit !== undefined && commit !== expectedCommit)) {
    throw new Error('Report commit does not match the expected source revision.');
  }
  const paths = report.changedPaths;
  if (paths !== null && !(Array.isArray(paths) && paths.every(path => typeof path === 'string'))) {
    throw new Error('Invalid changed path list.');
  }
  const plan = selectChecks(paths as string[] | null);
  if (!isDeepStrictEqual(report.plan, plan)) throw new Error('Recorded check plan differs from the release policy.');
  if (!Array.isArray(report.results) || !report.results.every(isCheckResult)) {
    throw new Error('Invalid check evidence.');
  }
  const actual = decide(plan.selected, report.results);
  if (report.decision !== actual.decision || !isDeepStrictEqual(report.reasons, actual.reasons)) {
    throw new Error('Recorded verdict differs from the replayed release policy.');
  }
  const digests = await evidenceDigests(directory);
  if (!isDeepStrictEqual(report.evidenceDigests, digests)) throw new Error('Evidence file digests do not match the report.');
  for (const result of report.results) {
    const file = primaryEvidence[result.id];
    if (result.status !== 'error' && file && !Object.hasOwn(digests, file)) {
      throw new Error('Missing primary evidence for ' + result.id + '.');
    }
  }
  return { ...actual, commit, policyVersion: releasePolicyVersion, verifiedFiles: Object.keys(digests) };
}
