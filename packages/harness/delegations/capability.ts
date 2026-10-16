import type { CapabilityWord, StageBracket } from '@uw/contracts';
import type { Delegation, PageFacts } from '../ports.ts';

const reach: ReadonlyMap<CapabilityWord, ReadonlySet<StageBracket>> = new Map([
  ['none', new Set<StageBracket>()],
  ['build', new Set<StageBracket>(['build_package'])],
  ['review', new Set<StageBracket>(['build_package'])],
  ['iterate', new Set<StageBracket>(['iterate'])],
  ['fix', new Set<StageBracket>(['build_package'])],
]);

const lentTo: ReadonlyMap<CapabilityWord, CapabilityWord> = new Map([['fix', 'build']]);

export function capabilityReaches(capability: CapabilityWord, bracket: StageBracket): boolean {
  return reach.get(capability)?.has(bracket) ?? false;
}

export function pageAgrees(page: PageFacts | null, delegation: Delegation): boolean {
  if (page === null) return true;
  const wanted = lentTo.get(delegation.capability) ?? delegation.capability;
  return page.frontmatter['capability'] === wanted;
}
