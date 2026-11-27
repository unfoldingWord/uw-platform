import { capabilityWordSchema, type CapabilityWord, type StageBracket } from '@uw/contracts';
import type { Delegation, PageFacts } from '../ports.ts';

type CapabilityGrantor = 'area_admin' | 'harness_person';
type CapabilityHarness = 'workflow' | 'personal';

export type CapabilityPolicy = {
  readonly reach: ReadonlySet<StageBracket>;
  readonly grantor: CapabilityGrantor;
  readonly on: CapabilityHarness;
  readonly workflowBeat: boolean;
  readonly device: boolean;
};

function workflowPolicy(brackets: readonly StageBracket[]): CapabilityPolicy {
  return {
    reach: new Set(brackets),
    grantor: 'area_admin',
    on: 'workflow',
    workflowBeat: true,
    device: true,
  };
}

const policies: Readonly<Record<CapabilityWord, CapabilityPolicy>> = {
  none: workflowPolicy([]),
  iterate: workflowPolicy(['iterate']),
  build: workflowPolicy(['build_package']),
  review: workflowPolicy(['build_package']),
  merge: workflowPolicy([]),
  fix: workflowPolicy(['build_package']),
  assist: {
    reach: new Set(),
    grantor: 'harness_person',
    on: 'personal',
    workflowBeat: false,
    device: false,
  },
};

const registry: ReadonlyMap<string, CapabilityPolicy> = new Map(Object.entries(policies));

const unknownWord: CapabilityPolicy = {
  reach: new Set(),
  grantor: 'area_admin',
  on: 'workflow',
  workflowBeat: false,
  device: false,
};

const lentTo: ReadonlyMap<CapabilityWord, CapabilityWord> = new Map([['fix', 'build']]);

export function policyOf(capability: CapabilityWord): CapabilityPolicy {
  return registry.get(capability) ?? unknownWord;
}

export function capabilityReaches(capability: CapabilityWord, bracket: StageBracket): boolean {
  return policyOf(capability).reach.has(bracket);
}

export function grantableFor(capability: CapabilityWord): readonly CapabilityWord[] {
  return capabilityWordSchema.options.filter(
    (granted) => granted !== 'none' && (lentTo.get(granted) ?? granted) === capability,
  );
}

export function pageAgrees(page: PageFacts | null, delegation: Delegation): boolean {
  if (page === null) return true;
  const wanted = lentTo.get(delegation.capability) ?? delegation.capability;
  return page.frontmatter['capability'] === wanted;
}
