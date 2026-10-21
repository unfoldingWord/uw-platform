import { riskDomainSchema, riskTierSchema } from '@uw/contracts';
import type { RiskDeclaration, RiskDomain, RiskTier } from '@uw/contracts';
import { protectedDirectories } from './protected-directories.ts';

export type RiskFloor = { readonly tier: RiskTier | null; readonly domains: readonly RiskDomain[] };

export type RiskResult =
  | { readonly ok: true; readonly tier: RiskTier; readonly domains: readonly RiskDomain[] }
  | {
      readonly ok: false;
      readonly reason: 'risk_tier_undeclared';
      readonly domains: readonly RiskDomain[];
    };

export function normalise(path: string): string {
  const kept: string[] = [];
  for (const segment of path.replaceAll('\\', '/').toLowerCase().split('/')) {
    if (segment === '..') kept.pop();
    else if (segment !== '' && segment !== '.') kept.push(segment);
  }
  return kept.join('/');
}

export function matches(entry: string, path: string): boolean {
  const base = normalise(entry);
  if (entry.endsWith('/')) return path === base || path.startsWith(`${base}/`);
  return path === base;
}

export function domainOf(path: string): RiskDomain | null {
  const clean = normalise(path);
  const hit = protectedDirectories.find((entry) => matches(entry.path, clean));
  return hit === undefined ? null : hit.domain;
}

function inSchemaOrder(domains: ReadonlySet<RiskDomain>): readonly RiskDomain[] {
  return riskDomainSchema.options.filter((domain) => domains.has(domain));
}

export function floorFromPaths(paths: readonly string[]): RiskFloor {
  const found = new Set<RiskDomain>();
  for (const path of paths) {
    const domain = domainOf(path);
    if (domain !== null) found.add(domain);
  }
  return { tier: found.size > 0 ? 'high' : null, domains: inSchemaOrder(found) };
}

function rankOf(tier: RiskTier | null): number {
  return tier === null ? -1 : riskTierSchema.options.indexOf(tier);
}

function higher(left: RiskTier | null, right: RiskTier | null): RiskTier | null {
  return rankOf(left) >= rankOf(right) ? left : right;
}

export function carryForward(floor: RiskFloor, previous: RiskFloor): RiskFloor {
  const domains = inSchemaOrder(new Set([...floor.domains, ...previous.domains]));
  return { tier: higher(floor.tier, previous.tier), domains };
}

export function applyDeclaration(
  floor: RiskFloor,
  declaration: RiskDeclaration | null,
): RiskResult {
  if (declaration === null) {
    return { ok: false, reason: 'risk_tier_undeclared', domains: floor.domains };
  }
  const domains = inSchemaOrder(new Set([...floor.domains, ...declaration.riskDomains]));
  const tier = higher(floor.tier, declaration.riskTier) ?? declaration.riskTier;
  return { ok: true, tier, domains };
}
