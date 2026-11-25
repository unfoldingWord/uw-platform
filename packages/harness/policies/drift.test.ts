import { describe, expect, it } from 'vitest';
import { templateDrift } from './drift.ts';

const copy = (id: string, sourceId: string, version: number) => ({
  id,
  source: { pageId: sourceId, version },
});

describe('PO-5 a copy of a template policy drifts when its source moves on', () => {
  it('names each copy behind its source, with both versions', () => {
    const drift = templateDrift(
      [copy('current', 'wip', 3), copy('behind', 'wip', 1), copy('far', 'consent', 2)],
      [
        { id: 'wip', version: 3, status: 'active' },
        { id: 'consent', version: 7, status: 'active' },
      ],
    );
    expect(drift).toEqual([
      { copyId: 'behind', sourceId: 'wip', copied: 1, current: 3, state: 'behind' },
      { copyId: 'far', sourceId: 'consent', copied: 2, current: 7, state: 'behind' },
    ]);
  });

  it('names a copy whose source is retired or gone', () => {
    const drift = templateDrift(
      [copy('orphan', 'gone', 1), copy('stale', 'old', 4)],
      [{ id: 'old', version: 4, status: 'retired' }],
    );
    expect(drift).toEqual([
      { copyId: 'orphan', sourceId: 'gone', copied: 1, current: null, state: 'source_missing' },
      { copyId: 'stale', sourceId: 'old', copied: 4, current: 4, state: 'source_retired' },
    ]);
  });
});
