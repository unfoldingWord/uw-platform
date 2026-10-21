import { describe, expect, it } from 'vitest';
import { ApproveAll, type Approvable } from './approve-all.tsx';

function batchOf(count: number, total: number): Approvable {
  const entries = Array.from({ length: count }, (_, n) => ({
    itemId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    head: 'a'.repeat(40),
  }));
  return { harnessId: '00000000-0000-4000-8000-0000000000a1', harnessKey: 'web', entries, total };
}

describe('GD-1 the approve-all control names how many gates it approves', () => {
  it('GD-1 names all the gates shown, or the first 50 of more', () => {
    expect(String(ApproveAll({ batch: batchOf(3, 3) }))).toContain(
      'Approve all 3 gates shown on web',
    );
    expect(String(ApproveAll({ batch: batchOf(50, 64) }))).toContain(
      'Approve the first 50 of 64 gates shown on web',
    );
  });
});
