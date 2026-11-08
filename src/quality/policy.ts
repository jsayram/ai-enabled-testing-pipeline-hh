export const checks = {
  'api-contract': { owner: 'Checkout', required: true },
  'browser-desktop': { owner: 'Checkout', required: true },
  'assistant-eval': { owner: 'Support', required: true },
  'browser-mobile': { owner: 'Checkout', required: false },
  'load-smoke': { owner: 'Platform', required: false },
} as const;

export type CheckId = keyof typeof checks;
export type CheckStatus = 'pass' | 'fail' | 'review' | 'error';
export type CheckResult = { id: CheckId; status: CheckStatus; summary: string; durationMs: number };
export type Decision = 'SHIP' | 'REVIEW' | 'BLOCK';

const allChecks = Object.keys(checks) as CheckId[];
const required = allChecks.filter(id => checks[id].required);
const rules = [
  { path: /^src\/app\/(checkout|server)\.ts$/, scope: 'checkout', add: ['browser-mobile', 'load-smoke'] },
  { path: /^tests\/e2e\//, scope: 'browser-tests', add: ['browser-mobile', 'load-smoke'] },
  { path: /^src\/app\/(support|product-model)\.ts$/, scope: 'assistant', add: ['browser-mobile'] },
  { path: /^docs\/.*\.md$|^README\.md$/, scope: 'documentation', add: [] },
] satisfies { path: RegExp; scope: string; add: CheckId[] }[];

export function changeScope(path: string) {
  return rules.find(rule => rule.path.test(path))?.scope ?? 'unknown';
}

export function selectChecks(paths: string[] | null) {
  const reasons: Partial<Record<CheckId, string>> = Object.fromEntries(required.map(id => [id, 'Required release control']));
  if (paths === null || paths.length === 0) {
    return { selected: allChecks, reasons: Object.fromEntries(allChecks.map(id => [id, 'Full run: change scope unavailable or empty'])) };
  }
  for (const path of paths) {
    const matches = rules.filter(rule => rule.path.test(path));
    if (!matches.length) {
      return { selected: allChecks, reasons: Object.fromEntries(allChecks.map(id => [id, 'Full run: unmapped changed path'])) };
    }
    for (const { add } of matches) {
      for (const id of add) reasons[id] ??= 'Added by change impact rule';
    }
  }
  return { selected: allChecks.filter(id => reasons[id]), reasons };
}

export function decide(selected: CheckId[], results: CheckResult[]): { decision: Decision; reasons: string[] } {
  const expected = new Set([...required, ...selected]);
  const blocking = [];
  const review = [];
  for (const id of expected) {
    const matching = results.filter(result => result.id === id);
    if (matching.length !== 1) {
      blocking.push(id + ': expected exactly one result, found ' + matching.length);
    } else {
      const status = matching[0]!.status;
      if (status === 'review') review.push(id + ': unresolved evidence requires owner review');
      else if (status !== 'pass') blocking.push(id + ': ' + status);
    }
  }
  if (results.some(r => !expected.has(r.id))) blocking.push('Unexpected check evidence');
  if (blocking.length) return { decision: 'BLOCK', reasons: [...blocking, ...review] };
  if (review.length) return { decision: 'REVIEW', reasons: review };
  return { decision: 'SHIP', reasons: ['All selected checks passed with complete evidence'] };
}
