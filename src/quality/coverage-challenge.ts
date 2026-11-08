import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { identifyLocalModel, localJson } from '../ai/ollama.ts';
import { coverageFixtures, withCoverageFixture } from './coverage-fixture.ts';
import type { CoverageFixture } from './coverage-fixture.ts';
import { withAdvisoryDeadline } from './deadline.ts';
import { apiContract, postOrder } from './http.ts';
import { writeJson } from './io.ts';

export type Recipe = { firstReply: 'delivered' | 'withheld'; retries: 'one' | 'two-parallel' };
type Probe = { outcome: 'passed' | 'caught' | 'error'; detail: string };

export type CoverageReport = {
  version: 'checkout-coverage/v1';
  mode: 'live' | 'replay';
  model: { tag: string; digest: string } | null;
  recipe: Recipe | null;
  rows: { id: string; label: string; baseline: Probe; candidate: Probe | null }[];
  result: { qualified: boolean; faults: number; baselineCaught: number; augmentedCaught: number; added: string[] };
};

const snapshot = 'docs/evidence/coverage-challenge.json';
const options = {
  firstReply: ['delivered', 'withheld'],
  retries: ['one', 'two-parallel'],
} as const;

function parseRecipe(value: unknown): Recipe | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'firstReply,retries') return null;
  const recipe = value as Partial<Recipe>;
  if (!recipe.firstReply || !options.firstReply.includes(recipe.firstReply) ||
      !recipe.retries || !options.retries.includes(recipe.retries)) return null;
  return { firstReply: recipe.firstReply, retries: recipe.retries };
}

async function propose(model: string) {
  return await withAdvisoryDeadline(async signal => {
    const identity = await identifyLocalModel(model, signal);
    const raw = await localJson(identity.tag,
      'Draft one checkout retry probe that complements the existing API contract. ' +
      'Choose one value for firstReply and one value for retries. Prefer a boundary the suite has not exercised. ' +
      'The harness owns the shopper, request bodies, idempotency key, and assertions.',
      {
        checkoutContract: 'Repeating an approved checkout for the same shopper with the same idempotency key returns the original paid receipt.',
        existingCoverage: 'Receives the first approved response, then checks two parallel retries with the same key.',
        choices: {
          firstReply: { delivered: 'Receive the initial response normally.', withheld: 'Simulate a client deadline after the service completes the request.' },
          retries: { one: 'Retry once.', 'two-parallel': 'Send two retries concurrently.' },
        },
      },
      { type: 'object', additionalProperties: false, required: ['firstReply', 'retries'],
        properties: { firstReply: { enum: options.firstReply }, retries: { enum: options.retries } } },
      0, 0, signal);
    return { identity, recipe: parseRecipe(raw) };
  }, 10000);
}

function paidReceipt(status: number, body: unknown) {
  assert.equal(status, 201, 'Expected a successful checkout');
  assert.ok(body !== null && typeof body === 'object', 'Expected a paid receipt');
  const receipt = body as { id?: unknown; status?: unknown; totalCents?: unknown };
  assert.ok(typeof receipt.id === 'string' && /^order-\d+$/.test(receipt.id), 'Expected an order ID');
  assert.equal(receipt.status, 'paid', 'Expected a paid order');
  assert.equal(receipt.totalCents, 2400, 'Expected the published order total');
  return receipt;
}

async function runDraft(recipe: Recipe, fixture: CoverageFixture) {
  const key = randomUUID();
  let original;
  if (recipe.firstReply === 'withheld') {
    const withheld = fixture.withholdReply(key);
    const controller = new AbortController();
    const pending = postOrder(fixture.base, key, 'approved', 'a',
      AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]))
      .then(() => new Error('Gateway delivered the initial reply instead of withholding it'), error => error as Error);
    const committed = await Promise.race([withheld, pending.then(error => { throw error; })]);
    // Trigger the client deadline only after the gateway saw the commit. No sleep or timing race.
    controller.abort(new DOMException('Simulated client deadline expired', 'TimeoutError'));
    if ((await pending).name !== 'TimeoutError') throw new Error('The client did not receive a deadline error');
    original = paidReceipt(committed.status, committed.body);
  } else {
    const response = await postOrder(fixture.base, key, 'approved');
    original = paidReceipt(response.status, await response.json());
  }
  const retries = await Promise.all(Array.from({ length: recipe.retries === 'two-parallel' ? 2 : 1 }, async () => {
    const response = await postOrder(fixture.base, key, 'approved');
    return paidReceipt(response.status, await response.json());
  }));
  for (const receipt of retries) {
    assert.equal(receipt.id, original.id, 'Retry returned ' + receipt.id + ' instead of the committed receipt ' + original.id);
    assert.deepEqual(receipt, original, 'Retry changed the original receipt');
  }
  return 'Retry returned the original paid receipt ' + original.id;
}

async function observe(run: () => Promise<string>): Promise<Probe> {
  try {
    return { outcome: 'passed', detail: await run() };
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split('\n')[0] ?? 'Test failed') : 'Unknown test failure';
    return { outcome: error instanceof assert.AssertionError ? 'caught' : 'error', detail };
  }
}

const model = process.env.OLLAMA_AGENT_MODEL;
let identity: CoverageReport['model'] = null;
let recipe: Recipe | null = null;
let recordedResult: CoverageReport['result'] | undefined;
if (model) {
  try { ({ identity, recipe } = await propose(model)); }
  catch (error) {
    console.error('Could not draft a recipe with the configured local model.');
    throw error;
  }
} else {
  const recorded = JSON.parse(await readFile(snapshot, 'utf8')) as CoverageReport;
  if (recorded.version !== 'checkout-coverage/v1' || recorded.mode !== 'live' || !recorded.model) {
    throw new Error('Expected a recorded live model draft.');
  }
  identity = recorded.model;
  recipe = parseRecipe(recorded.recipe);
  if (!recipe) throw new Error('The recorded draft does not match the recipe schema.');
  recordedResult = recorded.result;
}

const rows = [];
for (const fixture of coverageFixtures) {
  const baseline = await observe(() => withCoverageFixture(fixture.id, ({ base }) => apiContract(base)));
  const candidate = recipe ? await observe(() => withCoverageFixture(fixture.id, target => runDraft(recipe, target))) : null;
  rows.push({ ...fixture, baseline, candidate });
}
const [healthy, control] = rows;
const faults = rows.slice(1);
const qualified = healthy?.baseline.outcome === 'passed' && healthy.candidate?.outcome === 'passed' &&
  rows.every(row => row.candidate?.outcome !== 'error') && faults.some(row => row.candidate?.outcome === 'caught');
const baselineCaught = faults.filter(row => row.baseline.outcome === 'caught').length;
const added = qualified ? faults.filter(row => row.baseline.outcome === 'passed' && row.candidate?.outcome === 'caught').map(row => row.id) : [];
const report: CoverageReport = {
  version: 'checkout-coverage/v1', mode: model ? 'live' : 'replay', model: identity, recipe, rows,
  result: { qualified, faults: faults.length, baselineCaught, augmentedCaught: baselineCaught + added.length, added },
};
const output = 'artifacts/coverage-challenge/' + report.mode + '.json';
await writeJson(output, report);
console.log('Baseline caught ' + baselineCaught + '/' + faults.length + ' faults. Baseline plus qualified draft caught ' +
  report.result.augmentedCaught + '/' + faults.length + '.');
for (const row of rows) {
  console.log(row.label + ' | baseline ' + row.baseline.outcome + ' | draft ' + (row.candidate?.outcome ?? 'rejected'));
}
console.log('Evidence: ' + output);
if (recordedResult) assert.deepEqual(report.result, recordedResult, 'Coverage changed from the published evidence');
if (healthy?.baseline.outcome !== 'passed' || control?.baseline.outcome !== 'caught' ||
    rows.some(row => row.baseline.outcome === 'error' || row.candidate?.outcome === 'error') ||
    (!model && !qualified)) process.exitCode = 1;
