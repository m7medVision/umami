import 'dotenv/config';
import { experimentJobService } from '../src/lib/experiments/jobService';

const argumentsSet = new Set(process.argv.slice(2));
const unknown = [...argumentsSet].filter(argument => argument !== '--' && argument !== '--dry-run');
if (unknown.length) {
  throw new Error(`Unknown argument: ${unknown.join(', ')}`);
}

const result = await experimentJobService.run({ dryRun: argumentsSet.has('--dry-run') });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (result?.acquired && 'errors' in result && result.errors.length > 0) {
  process.exitCode = 1;
}
