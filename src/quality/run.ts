import { once } from 'node:events';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { JSONReport, JSONReportSuite } from 'playwright/types/testReporter';
import { createShop } from '../app/server.ts';
import { scenarioFrom } from '../app/checkout.ts';
import { replaySupport } from '../app/support.ts';
import { apiContract, loadSmoke } from './http.ts';
import { evaluate } from './eval.ts';
import { checks, decide, releasePolicyVersion, selectChecks } from './policy.ts';
import type { CheckId, CheckResult, CheckStatus } from './policy.ts';
import { runProcess, writeJson } from './io.ts';
import { advisoryPromptVersion, replayTriage, runAdvisory } from './advice.ts';
import { compareShadow, suggestOptionalChecks } from './shadow-selection.ts';
import { evidenceDigests } from './release-report.ts';
import { advisoryBudgetMs } from './deadline.ts';

async function browser(project: 'desktop' | 'mobile', base: string, dir: string): Promise<[CheckStatus, string]> {
  const json = join(dir, 'playwright-' + project + '.json');
  const run = await runProcess(['node_modules/@playwright/test/cli.js', 'test', '--project=' + project], {
    ...process.env, SHOP_URL: base, PW_JSON: json, PW_OUTPUT_DIR: join(dir, 'traces-' + project),
  }, 35000);
  if (run.code !== 0) {
    if (run.stderr || run.stdout) await writeFile(join(dir, 'playwright-' + project + '.log'), run.stdout + run.stderr);
    try { await readFile(json); }
    catch { return ['error', 'Browser runner exited without evidence']; }
    return ['fail', 'Playwright reported a failure; inspect JSON and traces'];
  }
  const report = JSON.parse(await readFile(json, 'utf8')) as JSONReport;
  const extract = (s: JSONReportSuite): JSONReportSuite['specs'] => [...s.specs, ...(s.suites ?? []).flatMap(extract)];
  const specs = report.suites.flatMap(extract);
  const tests = specs.flatMap(spec => spec.tests);
  const expectedTitles = ['approved payment shows a paid receipt', 'support renders the published shipping window'];
  if (report.errors.length || specs.length !== 2 || tests.length !== 2 ||
      expectedTitles.some(title => specs.filter(spec => spec.title === title).length !== 1) ||
      tests.some(t => t.projectName !== project || t.results.length !== 1 || t.results[0]?.status !== 'passed')) {
    return ['error', 'Incomplete or unexpected Playwright evidence'];
  }
  const drift = tests.flatMap(t => t.results[0]!.annotations).find(a => a.type === 'locator-drift');
  if (drift) return ['review', 'Locator recovery preserved assertions: ' + drift.description];
  return ['pass', 'Paid receipt and grounded support reply verified'];
}

async function main() {
  const { values } = parseArgs({ options: {
    scenario: { type: 'string', default: 'healthy' },
    changed: { type: 'string', multiple: true },
    'changed-file': { type: 'string' },
    out: { type: 'string', default: 'artifacts/gate' },
  } });
  const scenario = scenarioFrom(values.scenario);
  if (values.changed && values['changed-file']) throw new Error('Choose one change source');
  const paths = values['changed-file'] ? (await readFile(values['changed-file'], 'utf8')).split('\0').filter(Boolean) : values.changed ?? null;
  const plan = selectChecks(paths);
  const dir = resolve(values.out);
  await mkdir(dir, { recursive: true });
  // A new evidence directory avoids mixing artifacts from different releases.
  await writeFile(join(dir, '.run'), new Date().toISOString(), { flag: 'wx' });
  const server = createShop(scenario);
  server.listen(0, '127.0.0.1');

  const shadow = process.env.OLLAMA_AGENT_MODEL ? suggestOptionalChecks(process.env.OLLAMA_AGENT_MODEL, paths) : null;
  const results: CheckResult[] = [];
  let startupError: string | null = null;
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Shop did not start');
    const base = 'http://127.0.0.1:' + address.port;

    async function runCheck(id: CheckId): Promise<[CheckStatus, string]> {
      switch (id) {
        case 'api-contract': return ['pass', await apiContract(base)];
        case 'browser-desktop': return browser('desktop', base, dir);
        case 'browser-mobile': return browser('mobile', base, dir);
        case 'assistant-eval': {
          const result = await evaluate(replaySupport(scenario), [0, 1, 2], 'replay');
          await writeJson(join(dir, 'assistant-eval.json'), result);
          return [result.pass ? 'pass' : 'fail', result.passed + '/' + result.total + ' replay trials passed; ' +
            result.criticalFailures + ' critical failures'];
        }
        case 'load-smoke': {
          const result = await loadSmoke(base);
          await writeJson(join(dir, 'load-smoke.json'), result);
          return [result.pass ? 'pass' : 'fail', result.total + ' requests / ' + result.errors + ' errors; p95 ' +
            result.p95Ms + ' ms (budget ' + result.p95BudgetMs + ' ms); ' + result.requestsPerSecond + ' req/s'];
        }
      }
    }

    for (const id of plan.selected) {
      const start = performance.now();
      let result: [CheckStatus, string];
      try { result = await runCheck(id); }
      catch (error) {
        const text = error instanceof Error ? error.message.slice(0, 300) : 'Unknown error';
        result = [error instanceof Error && error.name === 'AssertionError' ? 'fail' : 'error', text];
      }
      results.push({ id, status: result[0], summary: result[1], durationMs: Math.round(performance.now() - start) });
    }
  } catch (error) {
    // No check can pass without a running service. The gate blocks on missing evidence.
    startupError = error instanceof Error ? error.message.slice(0, 300) : "Shop startup failed";
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }

  const decision = decide(plan.selected, results);
  const advisory = process.env.OLLAMA_AGENT_MODEL ?
    await runAdvisory(process.env.OLLAMA_AGENT_MODEL, plan.selected, results) :
    { mode: 'replay', selection: null, triage: replayTriage(results) };
  const suggestion = await shadow;
  const shadowSelection = suggestion ? compareShadow(suggestion, plan.selected, results) : null;
  const report = {
    schema: 2, policyVersion: releasePolicyVersion, scenario, commit: process.env.GITHUB_SHA ?? null,
    evidenceDigests: await evidenceDigests(dir),
    changedPaths: paths, plan, results, startupError, ...decision, shadowSelection,
    advisory: { ...advisory, promptVersion: advisoryPromptVersion, budgetMs: advisoryBudgetMs },
  };
  await writeJson(join(dir, 'release.json'), report);
  const cell = (s: string) => s.replace(/[\r\n]/g, ' ').replaceAll('|', '&#124;').replaceAll('<', '&lt;');
  const summary = [
    '# Release decision: ' + decision.decision, '',
    'Scenario: `' + scenario + '`', '',
    '| Check | Owner | Status | Evidence | Time |',
    '| --- | --- | --- | --- | ---: |',
    ...plan.selected.map(id => {
      const r = results.find(result => result.id === id);
      return '| ' + [id, checks[id].owner, r?.status ?? 'missing', cell(r?.summary ?? 'No result'), (r?.durationMs ?? 0) + ' ms'].join(' | ') + ' |';
    }), '',
    ...decision.reasons.map(r => '- ' + cell(r)), '',
    ...(startupError ? ['Service error: ' + cell(startupError), ''] : []),
    'Advisory mode: ' + advisory.mode + '. Advisory output cannot change this decision.', '',
    ...(advisory.selection?.[0] ? ['Suggested first check: ' + advisory.selection[0], ''] : []),
    ...('reason' in advisory ? ['Advisory fallback: ' + advisory.reason, ''] : []),
    ...advisory.triage.map(t => '- ' + t.id + ': ' + t.nextStep), '',
    ...(shadowSelection ? [
      'Shadow selection: ' + shadowSelection.suggested.join(', '),
      'Findings the shadow plan would have omitted: ' + (shadowSelection.omittedFindings.join(', ') || 'none observed'), '',
    ] : []),
  ].join('\n');
  await writeFile(join(dir, 'release.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  process.exitCode = decision.decision === 'SHIP' ? 0 : decision.decision === 'REVIEW' ? 2 : 1;
}

await main();
