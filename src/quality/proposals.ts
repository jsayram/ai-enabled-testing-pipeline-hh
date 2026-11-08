import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createCheckout } from '../app/checkout.ts';
import type { ApiResult, Scenario } from '../app/checkout.ts';
import { identifyLocalModel, localJson } from '../ai/ollama.ts';
import { writeJson } from './io.ts';

const operations = ['submit', 'retry', 'read-as-owner', 'read-as-other', 'conflicting-payment'] as const;
type Step = typeof operations[number];
type Proposal = { invariant: 'one-charge' | 'account-isolation'; steps: Step[] };
const replay: Proposal[] = [
  { invariant: 'one-charge', steps: ['submit', 'retry', 'conflicting-payment'] },
  { invariant: 'account-isolation', steps: ['submit', 'read-as-owner', 'read-as-other'] },
];
const required: Record<Proposal['invariant'], Step[]> = {
  'one-charge': ['retry'], 'account-isolation': ['read-as-owner', 'read-as-other'],
};
const mutants = ['duplicate-charge', 'privacy-leak'] as const;

export function parseProposal(value: unknown): Proposal | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { invariant, steps } = value as Partial<Proposal>;
  if (Object.keys(value).sort().join(',') !== 'invariant,steps' ||
      (invariant !== 'one-charge' && invariant !== 'account-isolation') || !Array.isArray(steps) ||
      steps.length > 5 || steps[0] !== 'submit' || new Set(steps).size !== steps.length ||
      !steps.every(step => operations.includes(step)) || !required[invariant].every(step => steps.includes(step))) return null;
  return { invariant, steps };
}

function execute(proposal: Proposal, scenario: Scenario) {
  const service = createCheckout(scenario);
  let receipt: ApiResult | undefined;
  let id = '';
  for (const step of proposal.steps) {
    switch (step) {
      case 'submit': {
        receipt = service.submit('a', 'candidate-key', 'approved');
        const body = receipt.body as { id?: string; status?: string; totalCents?: number };
        if (receipt.status !== 201 || body.status !== 'paid' || body.totalCents !== 2400 || !body.id) return false;
        id = body.id;
        break;
      }
      case 'retry':
        if (!isDeepStrictEqual(service.submit('a', 'candidate-key', 'approved'), receipt) || service.chargeCount() !== 1) return false;
        break;
      case 'read-as-owner':
        if (!isDeepStrictEqual(service.lookup('a', id), { status: 200, body: receipt?.body })) return false;
        break;
      case 'read-as-other':
        if (!isDeepStrictEqual(service.lookup('b', id), { status: 404, body: { error: 'not_found' } })) return false;
        break;
      case 'conflicting-payment':
        if (service.submit('a', 'candidate-key', 'declined').status !== 409) return false;
        break;
    }
  }
  return true;
}

export function qualifyProposal(value: unknown) {
  const proposal = parseProposal(value);
  if (!proposal) return { status: 'rejected', reason: 'Recipe is invalid or omits a required behavior', kills: [] };
  const baseline = execute(proposal, 'healthy');
  const kills = mutants.filter(mutant => !execute(proposal, mutant));
  const target = proposal.invariant === 'one-charge' ? 'duplicate-charge' : 'privacy-leak';
  return { status: baseline && kills.includes(target) ? 'review' : 'rejected', proposal, baseline, kills };
}

async function main() {
  const model = process.env.OLLAMA_AGENT_MODEL;
  let candidates: unknown = replay;
  let providerError = false;
  let identity = null;
  if (model) {
    try {
      identity = await identifyLocalModel(model);
      const output = await localJson(identity.tag,
        'Compose two checkout test recipes. Every recipe starts with submit, each operation is used at most once. ' +
        'For oneCharge, include retry and choose whether to check conflicting-payment. For accountIsolation, ' +
        'include read-as-owner and read-as-other in an order you choose. All operation names must be exact.',
        { availableOperations: operations },
        {
          type: 'object', required: ['oneCharge', 'accountIsolation'], additionalProperties: false,
          properties: {
            oneCharge: { type: 'array', minItems: 2, maxItems: 3, items: { enum: ['submit', 'retry', 'conflicting-payment'] } },
            accountIsolation: { type: 'array', minItems: 3, maxItems: 3, items: { enum: ['submit', 'read-as-owner', 'read-as-other'] } },
          },
        });
      const recipes = output as { oneCharge?: unknown; accountIsolation?: unknown };
      candidates = [
        { invariant: 'one-charge', steps: recipes?.oneCharge },
        { invariant: 'account-isolation', steps: recipes?.accountIsolation },
      ];
    } catch { providerError = true; candidates = []; }
  }
  const evaluated = Array.isArray(candidates) && candidates.length <= 2 ? candidates.map(qualifyProposal) : [];
  const coveredMutants = [...new Set(evaluated.filter(e => e.status === 'review').flatMap(e => e.kills))].sort();
  const output = { mode: model ? 'live' : 'replay', model: identity, providerError, evaluated,
    coveredMutants, qualified: evaluated.filter(e => e.status === 'review').length, offered: evaluated.length };
  await writeJson(model ? 'artifacts/proposals-live.json' : 'artifacts/proposals-replay.json', output);
  console.log(JSON.stringify(output, null, 2));
  if (providerError || output.qualified !== 2 || coveredMutants.length !== mutants.length ||
      new Set(evaluated.map(item => item.proposal?.invariant)).size !== 2) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
