import { identifyLocalModel, localJson } from '../ai/ollama.ts';
import { changeScope, checks } from './policy.ts';
import type { CheckId, CheckResult } from './policy.ts';

const options = {
  none: [],
  mobile: ['browser-mobile'],
  load: ['load-smoke'],
  both: ['browser-mobile', 'load-smoke'],
} satisfies Record<string, CheckId[]>;

type Option = keyof typeof options;

export function compareShadow(choice: Option, selected: CheckId[], results: CheckResult[]) {
  const mandatory = (Object.keys(checks) as CheckId[]).filter(id => checks[id].required);
  const suggested: CheckId[] = [...mandatory, ...options[choice]];
  return {
    suggested,
    skippedByShadow: selected.filter(id => !suggested.includes(id)),
    addedByShadowWithoutEvidence: suggested.filter(id => !selected.includes(id)),
    omittedFindings: results.filter(r => r.status !== 'pass' && !suggested.includes(r.id)).map(r => r.id),
  };
}

export async function suggestOptionalChecks(model: string, paths: string[] | null): Promise<Option | null> {
  // Use coarse trusted labels. Filenames and test outcomes never enter the selection prompt.
  const scopes = [...new Set(paths?.map(changeScope) ?? [])];
  if (!scopes.length || scopes.includes('unknown')) return 'both';
  try {
    const identity = await identifyLocalModel(model);
    const result = await localJson(identity.tag,
      'Suggest optional coverage in shadow mode before tests run. API, desktop browser, and assistant eval are always required. ' +
      'Optional coverage is mobile browser emulation and checkout concurrency smoke. Choose none, mobile, load, or both.',
      { scopes },
      { type: 'object', required: ['optional'], additionalProperties: false,
        properties: { optional: { enum: Object.keys(options) } } }) as { optional?: unknown };
    return typeof result?.optional === 'string' && Object.hasOwn(options, result.optional) ? result.optional as Option : null;
  } catch { return null; }
}
