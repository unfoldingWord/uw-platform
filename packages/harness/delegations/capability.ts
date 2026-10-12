import type { CapabilityWord, StageBracket } from '@uw/contracts';
import type { Delegation, PageFacts } from '../ports.ts';

const reach: ReadonlyMap<CapabilityWord, ReadonlySet<StageBracket>> = new Map([
  ['none', new Set<StageBracket>()],
  ['build', new Set<StageBracket>(['build_package'])],
  ['review', new Set<StageBracket>(['build_package'])],
  ['iterate', new Set<StageBracket>(['iterate'])],
]);

export function capabilityReaches(capability: CapabilityWord, bracket: StageBracket): boolean {
  return reach.get(capability)?.has(bracket) ?? false;
}

export function pageAgrees(page: PageFacts | null, delegation: Delegation): boolean {
  return page === null || page.frontmatter['capability'] === delegation.capability;
}
