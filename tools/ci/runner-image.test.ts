import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflows = '.github/workflows';
const pinned = 'ubuntu-24.04';

function runnerImages(): string[] {
  return readdirSync(workflows)
    .filter((file) => file.endsWith('.yml'))
    .sort()
    .flatMap((file) =>
      [...readFileSync(join(workflows, file), 'utf8').matchAll(/runs-on:\s*(\S+)/g)].map(
        (match) => `${file} ${match[1] ?? ''}`,
      ),
    );
}

describe('every job runs on one pinned runner image', () => {
  it(`pins ${pinned}, never ubuntu-latest, so a GitHub image change cannot move the screenshots or the browser`, () => {
    const images = runnerImages();
    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((entry) => !entry.endsWith(` ${pinned}`))).toEqual([]);
  });
});
