import { describe, expect, it } from 'vitest';
import { protectedAmong } from './protected-paths.ts';

describe('MD-4 protected paths are the kernel list and the harness list', () => {
  it('MD-4 names a path under a kernel protected directory whatever the harness lists', () => {
    expect(
      protectedAmong(['packages/db/migrations/0099_x.sql', 'apps/uw-app/board.tsx'], []),
    ).toEqual(['packages/db/migrations/0099_x.sql']);
  });

  it('MD-4 names a path under a directory or equal to a file the harness lists, after normalising', () => {
    const listed = ['src/billing/', 'deploy.sh'];
    expect(
      protectedAmong(
        ['src/billing/rates.ts', './Deploy.sh', 'src/billing', 'src/billingx.ts'],
        listed,
      ),
    ).toEqual(['src/billing/rates.ts', './Deploy.sh', 'src/billing']);
  });

  it('MD-4 names nothing for a change outside both lists', () => {
    expect(protectedAmong(['src/board.ts'], ['src/billing/'])).toEqual([]);
  });
});
