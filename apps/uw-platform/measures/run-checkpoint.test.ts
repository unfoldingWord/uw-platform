import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MOST_MEASURED_RESOURCES, type Prepared } from './run-steps.ts';

const WORKFLOW_STEP_RESULT_LIMIT_BYTES = 1_048_576;

describe('the prepare checkpoint of a measure run', () => {
  it('stays far below the Workflow step result limit at the most resources a run measures', () => {
    const resourceIds = Array.from({ length: MOST_MEASURED_RESOURCES }, () => randomUUID());
    const prepared: Prepared = { resourceIds };
    const bytes = new TextEncoder().encode(JSON.stringify(prepared)).length;
    expect(bytes).toBeLessThan(WORKFLOW_STEP_RESULT_LIMIT_BYTES / 20);
  });
});
