import { repositoryTrace } from './repository.ts';
import { formatTrace, traceExitCode } from './trace.ts';

const report = repositoryTrace();
process.stdout.write(`${formatTrace(report)}\n`);
process.exitCode = traceExitCode(report, process.argv.includes('--built') ? 'built' : 'all');
