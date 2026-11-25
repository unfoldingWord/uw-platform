import assert from 'node:assert/strict';
import { policyFrontmatterSchema } from '@uw/contracts';
import { resolvePolicies, type PolicyCandidate, type PolicyChain } from '@uw/harness';
import { defineScenario } from '../scenario.ts';

const PORTFOLIO = '7f1c6a52-3e7b-4b9a-9a51-6a0f2c1d8e40';
const PROGRAM = '0b6f2d4e-91a3-4c57-8e2d-3f5a7b9c1d20';
const PRODUCT = '5d2e8f1a-6b4c-4e9d-8a7f-2c3b1e0d9f61';
const ORG_WIP = 'a1000000-0000-4000-8000-000000000001';
const ORG_CONSENT = 'a1000000-0000-4000-8000-000000000002';
const PROGRAM_WIP = 'a1000000-0000-4000-8000-000000000003';
const PRODUCT_CONSENT = 'a1000000-0000-4000-8000-000000000004';
const CHARTER_TEMPLATE = 'a1000000-0000-4000-8000-000000000005';

const chain: PolicyChain = [
  { level: 'product', pageId: PRODUCT },
  { level: 'program', pageId: PROGRAM },
  { level: 'portfolio', pageId: PORTFOLIO },
  { level: 'organization', pageId: null },
];

const pages: readonly (readonly [string, unknown])[] = [
  [ORG_WIP, { enforcement: 'default', effective_from: '2026-01-01' }],
  [ORG_CONSENT, { enforcement: 'required', effective_from: '2026-01-01' }],
  [
    CHARTER_TEMPLATE,
    { enforcement: 'template', applies_to: PORTFOLIO, effective_from: '2026-06-01' },
  ],
  [
    PROGRAM_WIP,
    {
      enforcement: 'default',
      applies_to: PROGRAM,
      supersedes: [ORG_WIP],
      effective_from: '2026-03-01',
    },
  ],
  [
    PRODUCT_CONSENT,
    {
      enforcement: 'default',
      applies_to: PRODUCT,
      supersedes: [ORG_CONSENT],
      effective_from: '2026-03-01',
    },
  ],
];

function candidateOf([id, frontmatter]: readonly [string, unknown]): PolicyCandidate {
  const parsed = policyFrontmatterSchema.parse(frontmatter);
  return {
    id,
    enforcement: parsed.enforcement,
    appliesTo: parsed.applies_to,
    supersedes: parsed.supersedes,
    effectiveFrom: parsed.effective_from,
    effectiveUntil: parsed.effective_until,
  };
}

export const scenario = defineScenario({
  id: 'PO-2',
  title:
    'policies resolve from the product up to the organization: a program default replaces the organization default it supersedes, an organization requirement holds against a product that tries to supersede it, and the attempt is recorded',
  run: () => {
    const resolution = resolvePolicies(chain, pages.map(candidateOf), '2026-12-01');
    const inForce = resolution.inForce.map((policy) => [policy.level, policy.id]);
    assert.deepEqual(inForce, [
      ['product', PRODUCT_CONSENT],
      ['program', PROGRAM_WIP],
      ['portfolio', CHARTER_TEMPLATE],
      ['organization', ORG_CONSENT],
    ]);
    assert.deepEqual(resolution.yielded, [{ id: ORG_WIP, supersededBy: PROGRAM_WIP }]);
    assert.deepEqual(resolution.conflicts, [
      { id: PRODUCT_CONSENT, supersedes: ORG_CONSENT, why: 'required_holds' },
    ]);
    return Promise.resolve({
      state: {
        inForce,
        yielded: resolution.yielded.length,
        conflicts: resolution.conflicts.map((conflict) => conflict.why),
      },
    });
  },
});
