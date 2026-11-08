import { parseArgs } from 'node:util';
import { verifyReleaseReport } from './release-report.ts';

const { values } = parseArgs({ options: {
  dir: { type: 'string', default: 'artifacts/gate' },
  commit: { type: 'string' },
} });
try {
  const result = await verifyReleaseReport(values.dir, values.commit);
  console.log('Verified ' + result.decision + ' under ' + result.policyVersion + ' with ' + result.verifiedFiles.length + ' matching evidence files.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not verify the release report.');
  process.exitCode = 1;
}
