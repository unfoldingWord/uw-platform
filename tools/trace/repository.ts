import { readFileSync } from 'node:fs';
import { repoFiles } from '../repo-files.ts';
import { parseBuildOrder, parseRequirements } from './prd.ts';
import { provingTestFile, scenarioProofs, testProofs } from './proofs.ts';
import { completedSteps } from './tracker.ts';
import { trace, type TraceReport } from './trace.ts';

export function repositoryTrace(): TraceReport {
  const prd = readFileSync('docs/PRD.md', 'utf8');
  const paths = repoFiles();
  const fromTests = paths
    .filter((path) => provingTestFile.test(path))
    .flatMap((path) => testProofs(readFileSync(path, 'utf8')));
  return trace({
    requirements: parseRequirements(prd),
    steps: parseBuildOrder(prd),
    completed: completedSteps(readFileSync('docs/progress_tracker.md', 'utf8')),
    proven: new Set([...scenarioProofs(paths), ...fromTests]),
  });
}
