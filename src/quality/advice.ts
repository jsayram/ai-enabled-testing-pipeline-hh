import { identifyLocalModel, localJson } from '../ai/ollama.ts';
import type { CheckId, CheckResult } from './policy.ts';
import { AdvisoryDeadlineError, withAdvisoryDeadline } from './deadline.ts';

const actions = {
  'inspect-api-contract': 'Inspect the first failed API invariant and reproduce it with the contract suite.',
  'inspect-browser-trace': 'Open the Playwright trace and verify the request and receipt.',
  'review-locator': 'Ask Checkout to review the locator replacement against the unchanged behavior assertions.',
  'inspect-eval-cases': 'Inspect the failing golden case IDs and compare expected disposition and policy facts.',
  'rerun-load-isolated': 'Repeat on an isolated runner and compare error rate and p95 to the baseline.',
  'repair-runner': 'Inspect runner health and restore missing or invalid evidence before retrying.',
} as const;

type Action = keyof typeof actions;
type Issue = Pick<CheckResult, 'id' | 'status'>;
type Advice = { id: CheckId; nextStep: string };

function allowed(issue: Issue): Action[] {
  if (issue.status === 'error') return ['repair-runner'];
  if (issue.status === 'review') return ['review-locator', 'inspect-browser-trace'];
  switch (issue.id) {
    case 'api-contract': return ['inspect-api-contract'];
    case 'assistant-eval': return ['inspect-eval-cases'];
    case 'load-smoke': return ['rerun-load-isolated'];
    default: return ['inspect-browser-trace', 'inspect-api-contract'];
  }
}

const severity = { error: 0, fail: 1, review: 2, pass: 3 };

export function replayTriage(results: CheckResult[]): Advice[] {
  return results.filter(r => r.status !== 'pass')
    .sort((a, b) => severity[a.status] - severity[b.status])
    .map(r => ({ id: r.id, nextStep: actions[allowed(r)[0]!] }));
}

export function parseRanking(value: unknown, ids: CheckId[]) {
  if (!Array.isArray(value) || value.length !== ids.length || new Set(value).size !== ids.length ||
      !value.every(id => ids.includes(id))) return null;
  return value as CheckId[];
}

export const advisoryPromptVersion = 'release-triage/v2';
type AdvisoryInput = { priorityOptions: CheckId[]; issues: (Issue & { allowed: Action[] })[] };
type ModelIdentity = { tag: string; digest: string };
export type AdvisoryProvider = (request: {
  model: string; input: AdvisoryInput; schema: object; seed: number; signal: AbortSignal;
}) => Promise<{ identity: ModelIdentity; output: unknown }>;

const ollamaAdvisory: AdvisoryProvider = async ({ model, input, schema, seed, signal }) => {
  const identity = await identifyLocalModel(model, signal);
  const output = await localJson(identity.tag,
    'Choose one check to investigate first from priorityOptions. Address missing runner evidence before drawing conclusions. ' +
    'Prefer concrete failed behavior over locator-only review. When a service contract and its browser flow both fail, ' +
    'start with the service contract. For each issue choose one of its allowed actions. Return only the requested object.',
    input, schema, seed, 0.2, signal);
  return { identity, output };
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function runAdvisory(model: string, ids: CheckId[], results: CheckResult[], options: {
  provider?: AdvisoryProvider; budgetMs?: number; seed?: number;
} = {}) {
  // Test summaries, logs, and raw paths never cross this boundary.
  const issues = results.filter(r => r.status !== 'pass').map(r => ({ id: r.id, status: r.status, allowed: allowed(r) }));
  const priorities = issues.length ? issues.map(i => i.id) : [...ids];
  const schema = {
    type: 'object', required: ['priority', 'actions'], additionalProperties: false,
    properties: {
      priority: { enum: priorities },
      actions: { type: 'object', required: issues.map(i => i.id), additionalProperties: false,
        properties: Object.fromEntries(issues.map(i => [i.id, { enum: i.allowed }])) },
    },
  };
  let identity: ModelIdentity | undefined;
  const fallback = (reason: 'invalid-advice' | 'model-unavailable' | 'model-timeout') => ({
    mode: 'fallback' as const, model: identity ?? model, selection: null, triage: replayTriage(results), reason,
  });
  try {
    const response = await withAdvisoryDeadline(signal => (options.provider ?? ollamaAdvisory)({
      model, input: { priorityOptions: priorities, issues }, schema, seed: options.seed ?? 0, signal,
    }), options.budgetMs);
    identity = response.identity;
    const output = response.output;
    if (!record(output) || Object.keys(output).length !== 2 || !Object.hasOwn(output, 'priority') ||
        !Object.hasOwn(output, 'actions') || !priorities.includes(output.priority as CheckId) ||
        !record(output.actions) || Object.keys(output.actions).length !== issues.length) {
      return fallback('invalid-advice');
    }
    const priority = output.priority as CheckId;
    const ranking = [priority, ...ids.filter(id => id !== priority)];
    const chosen = output.actions;
    const triage = [];
    for (const issue of issues) {
      const action = chosen[issue.id] as Action;
      if (!Object.hasOwn(chosen, issue.id) || !issue.allowed.includes(action)) return fallback('invalid-advice');
      triage.push({ id: issue.id, nextStep: actions[action] });
    }
    if (!parseRanking(ranking, ids)) return fallback('invalid-advice');
    return { mode: 'live' as const, model: identity, selection: ranking, triage };
  } catch (error) {
    return fallback(error instanceof AdvisoryDeadlineError ? 'model-timeout' : 'model-unavailable');
  }
}
