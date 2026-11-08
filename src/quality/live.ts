import { isSupportResponse } from '../app/support.ts';
import type { SupportResponse } from '../app/support.ts';
import { evaluate } from './eval.ts';
import { calibrateJudge, judge, passesJudge } from './judge.ts';
import { writeJson } from './io.ts';
import { identifyLocalModel } from '../ai/ollama.ts';
import { golden } from './golden.ts';
import { localSupportModel, productPromptVersion } from '../app/product-model.ts';

const product = process.env.OLLAMA_PRODUCT_MODEL;
const judgeTag = process.env.OLLAMA_JUDGE_MODEL;
const repetitions = Number(process.env.OLLAMA_TRIALS ?? 3);
if (!product || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 8) {
  throw new Error('Set OLLAMA_PRODUCT_MODEL and use 1–8 trials per prompt');
}
const model = await identifyLocalModel(product);
const judgeModel = judgeTag ? await identifyLocalModel(judgeTag) : null;
const responses = new Map<string, SupportResponse>();
const candidate = localSupportModel(model.tag);
const result = await evaluate(async (question, seed) => {
  const response = await candidate(question, seed);
  if (judgeModel && isSupportResponse(response)) responses.set(JSON.stringify([question, seed]), response);
  return response;
}, Array.from({ length: repetitions }, (_, seed) => seed), 'live');

const calibration = judgeModel && await calibrateJudge((question, response) => judge(judgeModel.tag, question, response));
const semantic = [];
if (judgeModel && calibration?.eligible) {
  for (const trial of result.trials) {
    const fixture = golden.find(c => c.id === trial.id)!;
    const output = responses.get(JSON.stringify([fixture.question, trial.seed]));
    const verdict = output ? await judge(judgeModel.tag, fixture.question, output) : null;
    semantic.push({ id: trial.id, seed: trial.seed, verdict, pass: verdict === null ? null : passesJudge(verdict) });
  }
}
const output = { productPrompt: productPromptVersion, productModel: model, judgeModel, sameModel: judgeModel ? model.digest === judgeModel.digest : null,
  result, calibration, semantic, hardRulesPassed: result.pass };
await writeJson('artifacts/live-eval.json', output);
console.log('Live hard rules: ' + result.passed + '/' + result.total + ' passed; ' + result.criticalFailures + ' critical failures.');
for (const row of result.byCategory) console.log('  ' + row.category + ': ' + row.passed + '/' + row.total);
console.log('Judge: ' + (calibration ? calibration.agreed + '/' + calibration.total + ' agreed; ' +
  calibration.falseAccepts + ' false accepts; ' + (calibration.eligible ? 'eligible' : 'withheld') : 'not requested') + '.');
console.log('Evidence: artifacts/live-eval.json');
if (!result.pass || (calibration && !calibration.eligible) || semantic.some(row => row.pass !== true)) process.exitCode = 1;
