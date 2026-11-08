import type { CoverageReport } from '../src/quality/coverage-challenge.ts';

function escapeHtml(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function outcome(value: 'passed' | 'caught' | 'error', healthy: boolean) {
  const label = value === 'caught' ? 'Caught' : value === 'error' ? 'Error' : healthy ? 'Passed' : 'Missed';
  const status = value === 'error' ? 'error' : label === 'Missed' ? 'review' : 'pass';
  return '<td><span class="status status-' + status + '">' + label + '</span></td>';
}

export function renderCoverage({ model, recipe, rows, result }: CoverageReport) {
  if (!model || !recipe || !result.qualified) throw new Error('A qualified recorded draft is required');
  const summary = 'The existing API suite caught ' + result.baselineCaught + ' of ' + result.faults +
    ' injected faults. Adding the qualified draft raised that to ' + result.augmentedCaught + ' of ' + result.faults + '.';
  const finding = rows.find(row => result.added.includes(row.id));
  const description = model.tag + ' selected a ' + recipe.firstReply + ' first reply and ' +
    (recipe.retries === 'one' ? 'one retry' : 'two concurrent retries') +
    '. The harness checked that each retry returned the same paid receipt. The prompt contained the API contract and allowed operations.';
  const comparison = rows.map(row => {
    const healthy = row.id === 'healthy';
    const combined = row.baseline.outcome === 'passed' ? row.candidate?.outcome ?? 'error' : row.baseline.outcome;
    return '<tr><th scope="row">' + escapeHtml(row.label) + '</th>' +
      outcome(row.baseline.outcome, healthy) + outcome(combined, healthy) + '</tr>';
  }).join('\n');

  return [
    '<p class="bench-context">' + escapeHtml(summary) + '</p>',
    '<table class="coverage-table" aria-label="Injected faults caught by each checkout test suite">',
    '<thead><tr><th scope="col">Checkout fixture</th><th scope="col">Existing API suite</th><th scope="col">Suite + AI draft</th></tr></thead>',
    '<tbody>' + comparison + '</tbody></table>',
    '<p class="bench-context">' + escapeHtml(finding?.candidate?.detail ?? 'The draft added no coverage in this recorded run.') + '</p>',
    '<details><summary>Inspect the drafted test</summary><p class="bench-context">' + escapeHtml(description) + '</p></details>',
  ].join('\n');
}
