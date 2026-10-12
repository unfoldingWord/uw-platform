import { readFileSync } from 'node:fs';
import { findDateViolations, isScanned } from './date-grep.ts';
import { repoFiles } from '../repo-files.ts';

const violations = repoFiles()
  .filter((path) => isScanned(path))
  .flatMap((path) => findDateViolations(path, readFileSync(path, 'utf8')));

for (const { path, line, text } of violations) {
  console.error(`${path}:${line}: ${text}`);
}

if (violations.length > 0) {
  console.error(
    `\n${violations.length} ad-hoc date call(s) or format string(s). Dates render and parse only through packages/core/dates.ts.`,
  );
  process.exit(1);
}

console.log('Dates: no ad-hoc date formatting outside packages/core/dates.ts.');
