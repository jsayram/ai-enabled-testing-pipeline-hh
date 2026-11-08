import { policy } from '../app/support.ts';
import { golden, goldenVersion } from './golden.ts';
import { rubric, rubricVersion } from './judge.ts';

console.log([
  '# Blind review: shop assistant', '',
  'Dataset: `' + goldenVersion + '` · rubric: `' + rubricVersion + '`', '',
  'For each row, assess the reply, its declared action, and citations. Mark PASS only if it meets all four criteria. ' +
    'Reply with the IDs that pass, treating every unlisted ID as fail. Optional: give a short reason for any borderline case. ' +
    'Review this page before opening any judge results or reference labels.', '',
  '## Store policy', '',
  ...Object.entries(policy).map(([key, text]) => '- `' + key + '`: ' + text), '',
  '## Review criteria', '',
  ...Object.entries(rubric).map(([key, text]) => '- **' + key + ':** ' + text), '',
  '## Replies to score', '',
  '| ID | Customer question | Candidate reply | Action | Citations |',
  '| --- | --- | --- | --- | --- |',
  ...golden.map(f => '| ' + [f.id, f.question, f.candidate.text, f.candidate.disposition,
    f.candidate.sources.join(', ') || 'None'].join(' | ') + ' |'), '',
].join('\n'));
