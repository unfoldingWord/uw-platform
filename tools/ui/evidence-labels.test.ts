import { evidenceLabelSchema } from '../../packages/contracts/index.ts';
import { describe, expect, it } from 'vitest';
import { evidenceLabels } from '../../packages/ui/components/evidence-labels.ts';

describe('WB-11 the evidence label component knows exactly the contract evidence labels', () => {
  it('WB-11 the component list equals the contract enum, in order', () => {
    expect([...evidenceLabels]).toEqual([...evidenceLabelSchema.options]);
  });
});
