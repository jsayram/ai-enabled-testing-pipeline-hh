import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { identifyLocalModel } from '../ai/ollama.ts';
import { golden, goldenVersion } from './golden.ts';
import { compareJudge, judge, parseVerdict, rubricVersion, runJudge } from './judge.ts';
import type { JudgeRow, ReviewLabels } from './judge.ts';
import { writeJson } from './io.ts';

const { values } = parseArgs({ options: {
  results: { type: 'string', default: 'artifacts/eval/judge-verdicts.json' },
  labels: { type: 'string' },
  reuse: { type: 'boolean' },
  out: { type: 'string' },
} });
const provenance = { dataset: goldenVersion, rubric: rubricVersion };

async function readLabels(file: string): Promise<{ annotator: string; labels: ReviewLabels }> {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!data || data.dataset !== goldenVersion || data.rubric !== rubricVersion || data.complete !== true ||
      typeof data.annotator !== 'string' || !data.annotator.trim() || !Array.isArray(data.passIds) ||
      new Set(data.passIds).size !== data.passIds.length || data.passIds.some((id: unknown) => !golden.some(f => f.id === id))) {
    throw new Error('Provide a complete review with matching dataset/rubric, annotator, and unique known pass IDs');
  }
  const reasons = data.reasons ?? {};
  if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons) ||
      Object.entries(reasons).some(([id, reason]) => !golden.some(f => f.id === id) || typeof reason !== 'string' || reason.length > 500)) {
    throw new Error('Reasons must be short text keyed by known case IDs');
  }
  const labels = Object.fromEntries(golden.map(f => [f.id, { pass: data.passIds.includes(f.id),
    ...(typeof reasons[f.id] === 'string' ? { reason: reasons[f.id] } : {}) }]));
  return { annotator: data.annotator.trim(), labels };
}

const human = values.labels ? await readLabels(values.labels) : null;
let rows: JudgeRow[];
let model: { tag: string; digest: string };
if (human || values.reuse) {
  const saved = JSON.parse(await readFile(values.results, 'utf8'));
  if (!saved || saved.dataset !== provenance.dataset || saved.rubric !== provenance.rubric ||
      !Array.isArray(saved.rows) || typeof saved.model?.tag !== 'string' || !/^[a-f0-9]{64}$/.test(saved.model?.digest)) {
    throw new Error('Saved verdicts do not match this dataset and rubric');
  }
  model = saved.model;
  rows = saved.rows.map((row: JudgeRow) => {
    if (!row || typeof row.id !== 'string' || (row.verdict !== null && !parseVerdict(row.verdict))) {
      throw new Error('Invalid saved judge verdict');
    }
    return row;
  });
} else {
  const tag = process.env.OLLAMA_JUDGE_MODEL;
  if (!tag) throw new Error('Set OLLAMA_JUDGE_MODEL to an installed local model');
  model = await identifyLocalModel(tag);
  rows = await runJudge((question, response) => judge(model.tag, question, response));
  await writeJson(values.results, { ...provenance, model, rows });
}

const comparison = compareJudge(rows, human?.labels);
const out = values.out ?? (human ? 'artifacts/eval/judge-human' : 'artifacts/eval/judge-reference');
await writeJson(out + '.json', { ...provenance, model, annotator: human?.annotator ?? null, comparison });
const result = (pass: boolean | null) => pass === null ? 'abstain' : pass ? 'pass' : 'fail';
const oneLine = (value: string) => value.replace(/[\r\n]/g, ' ').replaceAll('|', '&#124;').replaceAll('<', '&lt;');
const markdown = [
  '# Judge agreement: ' + comparison.labelSource, '',
  'Dataset: `' + goldenVersion + '` · rubric: `' + rubricVersion + '` · model: `' + model.tag + '`', '',
  human ? 'Annotator: ' + oneLine(human.annotator) : 'These labels were authored for the lab. They are not independent human annotations.', '',
  '| Category | Agreement | False accepts | False rejects | Abstentions |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...[...comparison.byCategory, { category: '**All**', ...comparison }].map(c =>
    '| ' + [c.category, c.agreed + '/' + c.total, c.falseAccepts, c.falseRejects, c.abstained].join(' | ') + ' |'),
  '', '## Disagreements', '',
  '| ID | Label | Judge | Judge flagged | Label rationale |',
  '| --- | --- | --- | --- | --- |',
  ...comparison.disagreements.map(c => '| ' + [c.id, result(c.expectedPass), result(c.observed),
    c.judgeFailedDimensions.join(', ') || 'None', oneLine(c.labelReason ?? 'Not provided')].join(' | ') + ' |'),
  ...(comparison.disagreements.length ? [] : ['| — | — | — | — | None |']), '',
].join('\n');
await writeFile(out + '.md', markdown);
console.log(markdown);
if (comparison.abstained === comparison.total) process.exitCode = 1;
