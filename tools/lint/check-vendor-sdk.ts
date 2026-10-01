import { readFileSync } from 'node:fs';
import { findVendorViolations, isVendorScanned } from './vendor-sdk.ts';
import { repoFiles } from '../repo-files.ts';

const violations = repoFiles()
  .filter((path) => isVendorScanned(path))
  .flatMap((path) => findVendorViolations(path, readFileSync(path, 'utf8')));

for (const { path, line, text } of violations) {
  console.error(`${path}:${line}: ${text}`);
}

if (violations.length > 0) {
  console.error(
    `\n${violations.length} vendor SDK import(s) outside apps/uw-app/engines/<engine>/. A vendor SDK is named in one directory.`,
  );
  process.exit(1);
}

console.log('Vendor SDKs: imported only inside apps/uw-app/engines/<engine>/.');
