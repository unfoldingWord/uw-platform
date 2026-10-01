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

function grantAllows(grant: Grant, action: AclAction, resource: AclResource): boolean {
  if (grant.scopeKind === 'org') return reaches(grant.role, neededRole(action));
  if (resource.kind === 'org') return false;
  if (grant.scopeArea === resource.area) return reaches(grant.role, neededRole(action));
  return action === 'read' && reaches(grant.role, 'editor');
}

function isLive(grant: Grant, at: Date): boolean {
  return grant.expiresAt === null || new Date(grant.expiresAt).getTime() > at.getTime();
}

export function can(
  actor: Principal,
  action: AclAction,
  resource: AclResource,
  at: Date = new Date(),
): boolean {
  return actor.grants.some((grant) => isLive(grant, at) && grantAllows(grant, action, resource));
}

const actionByVerbRole: ReadonlyMap<Role, AclAction> = new Map<Role, AclAction>([
  [minimumRole.read, 'read'],
  [minimumRole.write, 'write'],
  [minimumRole.admin, 'admin'],
]);

export function actionForVerbRole(role: Role): AclAction {
  return actionByVerbRole.get(role) ?? 'admin';
}
