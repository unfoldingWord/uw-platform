import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { presentRoots } from './roots.ts';

const roots = presentRoots(existsSync);

try {
  execFileSync('depcruise', [...roots, '--config', '.dependency-cruiser.mjs'], {
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
