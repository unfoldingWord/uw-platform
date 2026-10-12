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

type ReadScope =
  | { readonly kind: 'org' }
  | { readonly kind: 'every-area' }
  | { readonly kind: 'area'; readonly area: JdArea }
  | null;

function readScope(grant: Grant): ReadScope {
  if (!reaches(grant.role, minimumRole.read)) return null;
  if (grant.scopeKind === 'org') return { kind: 'org' };
  if (reaches(grant.role, 'editor')) return { kind: 'every-area' };
  return { kind: 'area', area: grant.scopeArea };
}

function grantAllows(grant: Grant, action: AclAction, resource: AclResource): boolean {
  if (action === 'read') {
    const scope = readScope(grant);
    if (scope === null) return false;
    if (scope.kind === 'org') return true;
    if (resource.kind === 'org') return false;
    return scope.kind === 'every-area' || scope.area === resource.area;
  }
  if (grant.scopeKind === 'org') return reaches(grant.role, neededRole(action));
  if (resource.kind === 'org') return false;
  return grant.scopeArea === resource.area && reaches(grant.role, neededRole(action));
}

function isLive(grant: Grant, at: Date): boolean {
  return grant.expiresAt === null || new Date(grant.expiresAt).getTime() > at.getTime();
}

export function can(actor: Principal, action: AclAction, resource: AclResource, at: Date): boolean {
  return actor.grants.some((grant) => isLive(grant, at) && grantAllows(grant, action, resource));
}

type ReadableAreas =
  { readonly kind: 'all' } | { readonly kind: 'some'; readonly areas: readonly JdArea[] };

export function readableAreas(actor: Principal, at: Date): ReadableAreas {
  const scopes = actor.grants.filter((grant) => isLive(grant, at)).map(readScope);
  const areas = new Set<JdArea>();
  for (const scope of scopes) {
    if (scope?.kind === 'org' || scope?.kind === 'every-area') return { kind: 'all' };
    if (scope) areas.add(scope.area);
  }
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
