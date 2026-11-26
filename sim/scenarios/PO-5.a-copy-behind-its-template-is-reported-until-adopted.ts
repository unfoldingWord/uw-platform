import assert from 'node:assert/strict';
import { policyFrontmatterSchema } from '@uw/contracts';
import { templateDrift, type TemplateCopy } from '@uw/harness';
import { defineScenario } from '../scenario.ts';

const TEMPLATE = 'b1000000-0000-4000-8000-000000000001';
const PROJECT_COPY = 'b1000000-0000-4000-8000-000000000002';
const PROGRAM_COPY = 'b1000000-0000-4000-8000-000000000003';

function copyOf(id: string, version: number): TemplateCopy {
  const facts = policyFrontmatterSchema.parse({
    enforcement: 'default',
    effective_from: '2026-12-01',
    copied_from: { page_id: TEMPLATE, version },
  });
  const source = facts.copied_from;
  assert.ok(source !== null);
  return { id, source: { pageId: source.page_id, version: source.version } };
}

export const scenario = defineScenario({
  id: 'PO-5',
  title:
    'a copy of a template policy records the version it was copied from; when the template moves on, the copy is reported as behind until a person adopts the new version',
  run: () => {
    const copies = [copyOf(PROJECT_COPY, 2), copyOf(PROGRAM_COPY, 2)];
    const atTwo = templateDrift(copies, [{ id: TEMPLATE, version: 2, status: 'active' }]);
    assert.deepEqual(atTwo, []);
    const atThree = templateDrift(copies, [{ id: TEMPLATE, version: 3, status: 'active' }]);
    assert.deepEqual(
      atThree.map((drift) => [drift.copyId, drift.state]),
      [
        [PROJECT_COPY, 'behind'],
        [PROGRAM_COPY, 'behind'],
      ],
    );
    const adopted = [copyOf(PROJECT_COPY, 3), copyOf(PROGRAM_COPY, 2)];
    const afterAdopting = templateDrift(adopted, [{ id: TEMPLATE, version: 3, status: 'active' }]);
    assert.deepEqual(
      afterAdopting.map((drift) => drift.copyId),
      [PROGRAM_COPY],
    );
    return Promise.resolve({ state: { behindAtThree: atThree.length, behindAfterOne: 1 } });
  },
});
