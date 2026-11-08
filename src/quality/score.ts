import { writeFile } from 'node:fs/promises';
import { replaySupport } from '../app/support.ts';
import { evaluate } from './eval.ts';
import { writeJson } from './io.ts';

const seeds = [0, 1, 2];
const baseline = await evaluate(replaySupport('healthy'), seeds, 'replay');
const regression = await evaluate(replaySupport('eval-regression'), seeds, 'replay');
await writeJson('artifacts/eval/replay.json', { seeds, baseline, regression });
const report = [
  '# Product eval: ' + baseline.dataset, '',
  'Three replay samples per prompt. These results test the harness and injected faults.', '',
  '| Category | Cases | Healthy | Injected regression | Regression findings |',
  '| --- | ---: | ---: | ---: | --- |',
  ...baseline.byCategory.map(row => {
    const fault = regression.byCategory.find(r => r.category === row.category)!;
    const issues = Object.entries(fault.issues).map(([issue, count]) => issue + ' × ' + count).join(', ');
    return '| ' + [row.category, row.cases, row.passed + '/' + row.total, fault.passed + '/' + fault.total, issues || 'None'].join(' | ') + ' |';
  }),
  '| **All** | **' + baseline.perCase.length + '** | **' + baseline.passed + '/' + baseline.total + '** | **' +
    regression.passed + '/' + regression.total + '** | ' + regression.criticalFailures + ' critical trials |', '',
].join('\n');
await writeFile('artifacts/eval/replay.md', report);
console.log(report);
if (!baseline.pass || regression.pass || regression.criticalFailures === 0) process.exitCode = 1;
