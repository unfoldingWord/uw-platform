import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function rowOf(text: string, id: string): string | undefined {
  return text.split('\n').find((line) => line.startsWith(`| ${id} |`));
}

describe('MD-1 ADR 0010 records merge under delegation, and the spec and PRD cite it', () => {
  it('MD-1 the ADR names the decisions it changes and what was rejected', () => {
    const adr = readFileSync('docs/adr/0010-merge-under-delegation.md', 'utf8');
    for (const cited of [
      'ADR 0002',
      'ADR 0003',
      'ADR 0005',
      'ADR 0009',
      'An agent `merge` verb',
      'with no grantor',
    ]) {
      expect(adr).toContain(cited);
    }
  });

  it('MD-1 the spec rows D8 and D18 and PRD rows D8, D18 and V2-1 cite ADR 0010', () => {
    const spec = readFileSync('prd/Harness v1 - Architecture.md', 'utf8');
    const prd = readFileSync('docs/PRD.md', 'utf8');
    for (const id of ['D8', 'D18']) {
      expect(rowOf(spec, id)).toContain('ADR 0010');
      expect(rowOf(prd, id)).toContain('ADR 0010');
    }
    expect(rowOf(prd, 'V2-1')).toContain('ADR 0010');
  });
});
