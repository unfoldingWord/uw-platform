import type { JdArea, Principal, RiskDomain } from '@uw/contracts';
import { can, type AclResource } from '@uw/core/acl';

export const domainGrants: ReadonlyMap<RiskDomain, AclResource> = new Map<RiskDomain, AclResource>([
  ['ledger', { kind: 'area', area: '20-29' }],
  ['acl', { kind: 'org' }],
  ['infra', { kind: 'org' }],
  ['migration', { kind: 'org' }],
]);

export function requiredResources(
  area: JdArea,
  domains: readonly RiskDomain[],
): readonly AclResource[] {
  const resources: AclResource[] = [{ kind: 'area', area }];
  for (const domain of domains) {
    const resource = domainGrants.get(domain);
    if (resource !== undefined) resources.push(resource);
  }
  return resources;
}

export function approverCovers(
  approver: Principal,
  area: JdArea,
  domains: readonly RiskDomain[],
  at: Date,
): boolean {
  return requiredResources(area, domains).every((resource) => can(approver, 'admin', resource, at));
}
