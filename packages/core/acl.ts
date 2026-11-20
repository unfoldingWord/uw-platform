import type { Grant, JdArea, Principal, Role } from '@uw/contracts';

export type AclAction = 'read' | 'write' | 'admin';

export type AclResource =
  { readonly kind: 'org' } | { readonly kind: 'area'; readonly area: JdArea };

export const minimumRole: Readonly<Record<AclAction, Role>> = {
  read: 'viewer',
  write: 'editor',
  admin: 'admin',
};

const rank: ReadonlyMap<Role, number> = new Map<Role, number>([
  ['viewer', 1],
  ['editor', 2],
  ['admin', 3],
]);

function reaches(held: Role, needed: Role): boolean {
  return (rank.get(held) ?? 0) >= (rank.get(needed) ?? Number.POSITIVE_INFINITY);
}

const minimumRoleByAction: ReadonlyMap<string, Role> = new Map(Object.entries(minimumRole));

function neededRole(action: AclAction): Role {
  return minimumRoleByAction.get(action) ?? 'admin';
}

type ReadScope = { readonly kind: 'org' } | { readonly kind: 'area'; readonly area: JdArea } | null;

function readScope(grant: Grant): ReadScope {
  if (!reaches(grant.role, minimumRole.read)) return null;
  if (grant.scopeKind === 'org') return { kind: 'org' };
  return { kind: 'area', area: grant.scopeArea };
}

function grantAllows(grant: Grant, action: AclAction, resource: AclResource): boolean {
  if (action === 'read') {
    const scope = readScope(grant);
    if (scope === null) return false;
    if (scope.kind === 'org') return true;
    if (resource.kind === 'org') return false;
    return scope.area === resource.area;
  }
  if (grant.scopeKind === 'org') return reaches(grant.role, neededRole(action));
  if (resource.kind === 'org') return false;
  return grant.scopeArea === resource.area && reaches(grant.role, neededRole(action));
}

function isLive(grant: Grant, at: Date): boolean {
  return grant.expiresAt === null || new Date(grant.expiresAt).getTime() > at.getTime();
}

export type RowReadRule = {
  readonly area: Role | null;
  readonly owner: boolean;
  readonly orgAdmin: boolean;
};

const grantRecord: RowReadRule = { area: 'admin', owner: true, orgAdmin: true };
const personalRecord: RowReadRule = { area: null, owner: true, orgAdmin: true };
const lentRecord: RowReadRule = { area: 'viewer', owner: true, orgAdmin: true };
const areaRecord: RowReadRule = { area: 'viewer', owner: false, orgAdmin: true };

export const rowReadRules = {
  role_grants: grantRecord,
  grant_audit: grantRecord,
  person_audit: personalRecord,
  service_tokens: personalRecord,
  push_subscriptions: personalRecord,
  delegations: lentRecord,
  routines: lentRecord,
  gate_decisions: areaRecord,
} as const satisfies Readonly<Record<string, RowReadRule>>;

export type RestrictedTable = keyof typeof rowReadRules;

export type RowResource = {
  readonly kind: 'row';
  readonly table: RestrictedTable;
  readonly area: JdArea | null;
  readonly ownerId: string | null;
};

const rowReadRuleByTable: ReadonlyMap<string, RowReadRule> = new Map(Object.entries(rowReadRules));

function ownsRow(actor: Principal, row: RowResource): boolean {
  return actor.kind === 'person' && actor.personId !== null && actor.personId === row.ownerId;
}

function grantReadsRow(grant: Grant, rule: RowReadRule, row: RowResource): boolean {
  if (grant.scopeKind === 'org') return rule.orgAdmin && reaches(grant.role, minimumRole.admin);
  if (rule.area === null || row.area === null) return false;
  return grant.scopeArea === row.area && reaches(grant.role, rule.area);
}

function readsRow(actor: Principal, row: RowResource, at: Date): boolean {
  const rule = rowReadRuleByTable.get(row.table);
  if (rule === undefined) return false;
  if (rule.owner && ownsRow(actor, row)) return true;
  return actor.grants.some((grant) => isLive(grant, at) && grantReadsRow(grant, rule, row));
}

export function can(
  actor: Principal,
  action: AclAction,
  resource: AclResource | RowResource,
  at: Date,
): boolean {
  if (resource.kind === 'row') return action === 'read' && readsRow(actor, resource, at);
  return actor.grants.some((grant) => isLive(grant, at) && grantAllows(grant, action, resource));
}

export type ReadableAreas =
  { readonly kind: 'all' } | { readonly kind: 'some'; readonly areas: readonly JdArea[] };

export function readableAreas(actor: Principal, at: Date): ReadableAreas {
  const scopes = actor.grants.filter((grant) => isLive(grant, at)).map(readScope);
  const areas = new Set<JdArea>();
  for (const scope of scopes) {
    if (scope?.kind === 'org') return { kind: 'all' };
    if (scope) areas.add(scope.area);
  }
  return { kind: 'some', areas: [...areas].sort() };
}

export function grantedAreas(actor: Principal, at: Date): ReadableAreas {
  const live = actor.grants.filter((grant) => isLive(grant, at));
  if (live.some((grant) => grant.scopeKind === 'org')) return { kind: 'all' };
  const areas = new Set<JdArea>();
  for (const grant of live) if (grant.scopeKind === 'jd_area') areas.add(grant.scopeArea);
  return { kind: 'some', areas: [...areas].sort() };
}

export function adminAreas(actor: Principal, at: Date): ReadableAreas {
  const admin = actor.grants.filter(
    (grant) => isLive(grant, at) && reaches(grant.role, minimumRole.admin),
  );
  if (admin.some((grant) => grant.scopeKind === 'org')) return { kind: 'all' };
  const areas = new Set<JdArea>();
  for (const grant of admin) if (grant.scopeKind === 'jd_area') areas.add(grant.scopeArea);
  return { kind: 'some', areas: [...areas].sort() };
}

const actionByVerbRole: ReadonlyMap<Role, AclAction> = new Map<Role, AclAction>([
  [minimumRole.read, 'read'],
  [minimumRole.write, 'write'],
  [minimumRole.admin, 'admin'],
]);

export function actionForVerbRole(role: Role): AclAction {
  return actionByVerbRole.get(role) ?? 'admin';
}
