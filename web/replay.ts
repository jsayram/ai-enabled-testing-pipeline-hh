import { checks, decide, releasePolicyVersion, selectChecks } from '../src/quality/policy.ts';
import type { CheckId, CheckResult, Decision } from '../src/quality/policy.ts';
import type { CoverageReport } from '../src/quality/coverage-challenge.ts';

export type Replay = {
  id: string;
  changedPaths: string[] | null;
  results: CheckResult[];
  recordedDecision: Decision;
  verifiedFiles: number;
  advisory: 'recorded-checks' | 'model-unavailable';
};

const scenarios: Record<string, [string, string]> = {
  healthy: ['Healthy release', 'Checkout, browser behavior, assistant policy, and load checks all passed.'],
  'selector-drift': ['Locator changed', 'The expected button ID changed. A scoped alternative still produced the correct payment and receipt.'],
  'checkout-regression': ['Payment regression', 'A valid checkout request was declined and the browser could not confirm the order.'],
  'drift-with-regression': ['Locator and payment regression', 'The alternate button located the checkout action. The payment still failed.'],
  'eval-regression': ['Unsafe assistant response', 'Repeated evals caught unsafe advice and an unsupported shipping promise.'],
  'duplicate-charge': ['Duplicate charge', 'Retrying with the same idempotency key created another order.'],
  'privacy-leak': ['Order data exposed', 'The API allowed one shopper to read another shopper’s receipt.'],
  'provider-outage': ['AI provider outage', 'The assistant eval failed while the advisory model was unavailable. The gate used rules to suggest a next step.'],
};
const checkNames: Record<CheckId, string> = {
  'api-contract': 'API contract', 'browser-desktop': 'Desktop browser', 'assistant-eval': 'Assistant eval',
  'browser-mobile': 'Mobile browser', 'load-smoke': 'Load smoke',
};

function get<T extends HTMLElement = HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing page element ' + id);
  return node as T;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function load<T>(file: string): Promise<T> {
  const response = await fetch(new URL('../' + file, import.meta.url));
  if (!response.ok) throw new Error('Evidence file is unavailable');
  return await response.json() as T;
}

async function setupReplay() {
  const { policyVersion, replays } = await load<{ policyVersion: string; replays: Replay[] }>('evidence.json');
  if (policyVersion !== releasePolicyVersion || replays.length === 0) throw new Error('Evidence version mismatch');
  let selected = replays[0]!;
  const removeEvidence = get<HTMLInputElement>('remove-evidence');
  const buttons = new Map<string, HTMLButtonElement>();

  function render() {
    const [title, description] = scenarios[selected.id]!;
    get('scenario-title').textContent = title;
    get('scenario-description').textContent = description;
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === selected.id));
    const plan = selectChecks(selected.changedPaths);
    const results = removeEvidence.checked ? selected.results.filter(check => check.id !== 'assistant-eval') : selected.results;
    const { decision, reasons } = decide(plan.selected, results);
    get('verdict').textContent = decision;
    get('verdict-block').dataset.state = decision.toLowerCase();
    get('recorded-match').textContent = removeEvidence.checked
      ? 'Experiment active. The assistant eval result was removed for this replay.'
      : decision === selected.recordedDecision
        ? 'Matches the recorded verdict. ' + selected.verifiedFiles + ' primary evidence files verified at export.'
        : 'The browser verdict differs from the recorded run.';
    get('reasons').replaceChildren(...reasons.map(reason => element('li', reason)));
    get('checks').replaceChildren(...plan.selected.map(id => {
      const result = results.find(check => check.id === id);
      const status = result?.status ?? 'missing';
      const row = element('li', '', 'check');
      const name = element('div', '', 'check-name');
      name.append(element('strong', checkNames[id]), element('span', checks[id].owner));
      row.append(name, element('p', result?.summary ?? 'No result supplied. This check is required.', 'check-detail'),
        element('span', status, 'status status-' + status));
      return row;
    }));
    const advisory = get('advisory');
    advisory.hidden = selected.advisory !== 'model-unavailable';
    advisory.textContent = advisory.hidden ? '' :
      'AI advisory fallback · The model was unavailable. Rules recommended inspecting the failing assistant eval.';
  }

  for (const replay of replays) {
    const button = element('button', scenarios[replay.id]![0], 'scenario-button');
    button.type = 'button';
    button.addEventListener('click', () => {
      selected = replay;
      removeEvidence.checked = false;
      render();
    });
    buttons.set(replay.id, button);
    get('scenario-options').append(button);
  }
  removeEvidence.addEventListener('change', render);
  render();
  get('workspace').hidden = false;
  get('replay-error').hidden = true;
}

type Benchmark = {
  model: { tag: string };
  metrics: { baselineCorrect: number; incidents: number; liveCorrect: number; liveTrials: number;
    fallbacks: number; stableIncidents: number; p95Ms: number };
  boundary: { case: string; outcome: string; decision: Decision }[];
  paired: { id: string; expectedFirst: CheckId[]; baseline: CheckId;
    samples: { first: CheckId | null; fallback: string | null }[] }[];
};

async function setupBenchmark() {
  const { model, metrics, boundary, paired } = await load<Benchmark>('benchmark.json');
  const pairs = [
    [metrics.baselineCorrect + '/' + metrics.incidents, 'Rules chose a correct first check'],
    [metrics.liveCorrect + '/' + metrics.liveTrials, 'Model trials chose a correct first check'],
    [metrics.stableIncidents + '/' + metrics.incidents, 'Incidents with a repeatable model choice'],
  ];
  get('metrics').replaceChildren(...pairs.map(([value, label]) => {
    const metric = element('div', '', 'metric');
    metric.append(element('strong', value!), element('span', label!));
    return metric;
  }));
  get('bench-context').textContent = model.tag + ' ran three samples per incident. Some repeatable choices were wrong. ' +
    metrics.fallbacks + ' timeout fallback and ' + metrics.p95Ms + ' ms p95 advisory latency were recorded.';
  get('boundaries').replaceChildren(...boundary.map(row => {
    const item = element('li', '');
    item.append(element('strong', row.case), element('span', row.outcome + ' · ' + row.decision));
    return item;
  }));
  get('incidents').replaceChildren(...paired.map(row => {
    const item = element('li', '');
    item.append(element('strong', row.id),
      element('p', 'Expected first: ' + row.expectedFirst.map(id => checkNames[id]).join(' or ')),
      element('p', 'Rules: ' + checkNames[row.baseline]),
      element('p', 'Model samples: ' + row.samples.map(sample =>
        sample.first ? checkNames[sample.first] : (sample.fallback ?? 'no advice')).join(', ')));
    return item;
  }));
  get('benchmark-results').hidden = false;
  get('benchmark-error').hidden = true;
}

async function setupCoverage() {
  const { model, recipe, rows, result } = await load<CoverageReport>('coverage.json');
  if (!model || !recipe || !result.qualified) throw new Error('A qualified recorded draft is required');
  get('coverage-summary').textContent = 'The existing API suite caught ' + result.baselineCaught + ' of ' + result.faults +
    ' injected faults. Adding the qualified draft raised that to ' + result.augmentedCaught + ' of ' + result.faults + '.';

  function outcome(value: 'passed' | 'caught' | 'error', healthy: boolean) {
    const label = value === 'caught' ? 'Caught' : value === 'error' ? 'Error' : healthy ? 'Passed' : 'Missed';
    const status = value === 'error' ? 'error' : label === 'Missed' ? 'review' : 'pass';
    const cell = element('td', '');
    cell.append(element('span', label, 'status status-' + status));
    return cell;
  }

  get('coverage-rows').replaceChildren(...rows.map(row => {
    const tableRow = element('tr', '');
    const title = element('th', row.label);
    title.scope = 'row';
    const combined = row.baseline.outcome === 'passed' ? row.candidate?.outcome ?? 'error' : row.baseline.outcome;
    tableRow.append(title, outcome(row.baseline.outcome, row.id === 'healthy'), outcome(combined, row.id === 'healthy'));
    return tableRow;
  }));
  const finding = rows.find(row => result.added.includes(row.id));
  get('coverage-finding').textContent = finding?.candidate?.detail ?? 'The draft added no coverage in this recorded run.';
  get('coverage-recipe').textContent = model.tag + ' selected a ' + recipe.firstReply + ' first reply and ' +
    (recipe.retries === 'one' ? 'one retry' : 'two concurrent retries') +
    '. The harness checked that each retry returned the same paid receipt. The prompt contained the API contract and allowed operations.';
  get('coverage-results').hidden = false;
  get('coverage-error').hidden = true;
}

void setupReplay().catch(() => { get('replay-error').textContent = 'Could not load the replay evidence. Reload the page to try again.'; });
void setupCoverage().catch(() => { get('coverage-error').textContent = 'Could not load the coverage evidence.'; });
void setupBenchmark().catch(() => { get('benchmark-error').textContent = 'Could not load the benchmark evidence.'; });
