import { describe, expect, it } from 'vitest';
import { resolvePolicies, type PolicyCandidate, type PolicyChain } from './resolve.ts';

const PRODUCT = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const PROGRAM = '00000000-0000-4000-8000-000000000003';
const PORTFOLIO = '00000000-0000-4000-8000-000000000004';
const OTHER_PROGRAM = '00000000-0000-4000-8000-000000000005';

const chain: PolicyChain = [
  { level: 'product', pageId: PRODUCT },
  { level: 'project', pageId: PROJECT },
  { level: 'program', pageId: PROGRAM },
  { level: 'portfolio', pageId: PORTFOLIO },
  { level: 'organization', pageId: null },
];

const ON = '2026-12-01';

function policy(id: string, change: Partial<PolicyCandidate> = {}): PolicyCandidate {
  return {
    id,
    enforcement: 'default',
    appliesTo: null,
    supersedes: [],
    effectiveFrom: '2026-01-01',
    effectiveUntil: null,
    ...change,
  };
}

const ids = (resolution: ReturnType<typeof resolvePolicies>) =>
  resolution.inForce.map((found) => found.id);

describe('PO-2 resolution walks from the most specific level upward', () => {
  it('lists every policy in force on the chain, most specific first', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('org'),
        policy('portfolio', { appliesTo: PORTFOLIO }),
        policy('product', { appliesTo: PRODUCT }),
        policy('program', { appliesTo: PROGRAM }),
      ],
      ON,
    );
    expect(resolution.inForce.map((found) => [found.id, found.level])).toEqual([
      ['product', 'product'],
      ['program', 'program'],
      ['portfolio', 'portfolio'],
      ['org', 'organization'],
    ]);
  });

  it('leaves out a policy for a node off the chain', () => {
    const resolution = resolvePolicies(
      chain,
      [policy('sibling', { appliesTo: OTHER_PROGRAM }), policy('org')],
      ON,
    );
    expect(ids(resolution)).toEqual(['org']);
  });

  it('puts required before default before template at one level', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('a-template', { enforcement: 'template' }),
        policy('b-default'),
        policy('c-required', { enforcement: 'required' }),
      ],
      ON,
    );
    expect(ids(resolution)).toEqual(['c-required', 'b-default', 'a-template']);
  });
});

describe('PO-2 a default yields to a descendant that supersedes it', () => {
  it('drops the default and names what replaced it', () => {
    const resolution = resolvePolicies(
      chain,
      [policy('org-wip'), policy('project-wip', { appliesTo: PROJECT, supersedes: ['org-wip'] })],
      ON,
    );
    expect(ids(resolution)).toEqual(['project-wip']);
    expect(resolution.yielded).toEqual([{ id: 'org-wip', supersededBy: 'project-wip' }]);
    expect(resolution.conflicts).toEqual([]);
  });

  it('keeps a default that only a sibling branch supersedes', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('org-wip'),
        policy('elsewhere', { appliesTo: OTHER_PROGRAM, supersedes: ['org-wip'] }),
      ],
      ON,
    );
    expect(ids(resolution)).toEqual(['org-wip']);
  });

  it('refuses a supersession from the same level or above, and keeps both', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('program-rule', { appliesTo: PROGRAM }),
        policy('org-rule', { supersedes: ['program-rule'] }),
        policy('program-peer', { appliesTo: PROGRAM, supersedes: ['program-rule'] }),
      ],
      ON,
    );
    expect(ids(resolution)).toEqual(['program-peer', 'program-rule', 'org-rule']);
    expect(resolution.conflicts).toEqual([
      { id: 'org-rule', supersedes: 'program-rule', why: 'not_a_descendant' },
      { id: 'program-peer', supersedes: 'program-rule', why: 'not_a_descendant' },
    ]);
  });
});

describe('PO-2 a required policy cannot be overridden below', () => {
  it('keeps the required policy in force and records the attempt', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('org-safeguarding', { enforcement: 'required' }),
        policy('product-shortcut', { appliesTo: PRODUCT, supersedes: ['org-safeguarding'] }),
      ],
      ON,
    );
    expect(ids(resolution)).toEqual(['product-shortcut', 'org-safeguarding']);
    expect(resolution.yielded).toEqual([]);
    expect(resolution.conflicts).toEqual([
      { id: 'product-shortcut', supersedes: 'org-safeguarding', why: 'required_holds' },
    ]);
  });
});

describe('PO-2 a policy is in force only between its dates', () => {
  it('starts on its first day and stops on its last', () => {
    const resolution = resolvePolicies(
      chain,
      [
        policy('starts-today', { effectiveFrom: ON }),
        policy('starts-tomorrow', { effectiveFrom: '2026-12-02' }),
        policy('ended-today', { effectiveUntil: ON }),
        policy('ends-tomorrow', { effectiveUntil: '2026-12-02' }),
      ],
      ON,
    );
    expect(ids(resolution)).toEqual(['starts-today', 'ends-tomorrow']);
  });

  it('lets a superseded default return once its replacement ends', () => {
    const candidates = [
      policy('org-wip'),
      policy('project-wip', {
        appliesTo: PROJECT,
        supersedes: ['org-wip'],
        effectiveUntil: '2026-12-02',
      }),
    ];
    expect(ids(resolvePolicies(chain, candidates, ON))).toEqual(['project-wip']);
    expect(ids(resolvePolicies(chain, candidates, '2026-12-02'))).toEqual(['org-wip']);
  });
});

describe('PO-2 resolution without a cascade', () => {
  it('reads only organization policies when the entity is placed nowhere', () => {
    const resolution = resolvePolicies(
      [{ level: 'organization', pageId: null }],
      [policy('org'), policy('program', { appliesTo: PROGRAM })],
      ON,
    );
    expect(ids(resolution)).toEqual(['org']);
  });
});
