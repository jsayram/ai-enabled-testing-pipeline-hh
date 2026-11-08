import { identifyLocalModel, localJson } from '../ai/ollama.ts';
import type { CheckId, CheckResult } from './policy.ts';

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

export function replayTriage(results: CheckResult[]): Advice[] {
  return results.filter(r => r.status !== 'pass').map(r => ({ id: r.id, nextStep: actions[allowed(r)[0]!] }));
}

export function parseRanking(value: unknown, ids: CheckId[]) {
  if (!Array.isArray(value) || value.length !== ids.length || new Set(value).size !== ids.length ||
      !value.every(id => ids.includes(id))) return null;
  return value as CheckId[];
}

export async function runAdvisory(model: string, ids: CheckId[], results: CheckResult[]) {
  const issues = results.filter(r => r.status !== 'pass').map(r => ({ id: r.id, status: r.status, allowed: allowed(r) }));
  const fallback = replayTriage(results);
  const priorities = issues.length ? issues.map(i => i.id) : ids;
  let identity;
  try {
    identity = await identifyLocalModel(model);
    const output = await localJson(identity.tag,
      'Choose one check to review first from priorityOptions. For each issue, pick one action listed for that issue. ' +
      'Use the check ID as the key in the actions object. Use an empty actions object if there are no issues.',
      { priorityOptions: priorities, issues },
      {
        type: 'object', required: ['priority', 'actions'], additionalProperties: false,
        properties: {
          priority: { enum: priorities },
          actions: { type: 'object', required: issues.map(i => i.id), additionalProperties: false,
            properties: Object.fromEntries(issues.map(i => [i.id, { enum: i.allowed }])) },
        },
      }) as { priority?: CheckId; actions?: Record<string, Action> };
    if (!output?.priority || !priorities.includes(output.priority) || !output.actions || typeof output.actions !== 'object' || Array.isArray(output.actions) ||
        Object.keys(output.actions).length !== issues.length) {
      return { mode: 'fallback', model: identity, selection: null, triage: fallback, reason: 'invalid-advice' };
    }
    const ranking = [output.priority, ...ids.filter(id => id !== output.priority)];
    const triage = issues.flatMap(issue => {
      const action = output.actions?.[issue.id];
      return action && issue.allowed.includes(action) ? [{ id: issue.id, nextStep: actions[action] }] : [];
    });
    if (!parseRanking(ranking, ids) || triage.length !== issues.length) {
      return { mode: 'fallback', model: identity, selection: null, triage: fallback, reason: 'invalid-advice' };
    }
    return { mode: 'live', model: identity, selection: ranking, triage };
  } catch {
    return { mode: 'fallback', model: identity ?? model, selection: null, triage: fallback, reason: 'model-unavailable' };
  }
}
