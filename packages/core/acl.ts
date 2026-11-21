import type { Grant, JdArea, PersonStatus, Principal, Role } from '@uw/contracts';

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
const managedRecord: RowReadRule = { area: 'admin', owner: false, orgAdmin: true };

export const rowReadRules = {
  role_grants: grantRecord,
  grant_audit: grantRecord,
  person_audit: personalRecord,
  service_tokens: personalRecord,
  push_subscriptions: personalRecord,
  delegations: lentRecord,
  routines: lentRecord,
  gate_decisions: areaRecord,
  credentials: areaRecord,
  credential_versions: managedRecord,
  credential_grants: grantRecord,
  credential_bindings: managedRecord,
  credential_access_log: managedRecord,
  directory_private: lentRecord,
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

export type CredentialCapability = 'see' | 'use' | 'reveal' | 'manage';

export type CredentialRule = {
  readonly area: Role;
  readonly orgAdmin: boolean;
  readonly person: boolean;
};

export const credentialRules: Readonly<Record<CredentialCapability, CredentialRule>> = {
  see: { area: 'viewer', orgAdmin: true, person: true },
  use: { area: 'editor', orgAdmin: false, person: false },
  reveal: { area: 'viewer', orgAdmin: true, person: true },
  manage: { area: 'admin', orgAdmin: true, person: true },
};

export type CredentialBinding = {
  readonly harnessId: string;
  readonly connectorKey: string;
};

export type RevealGrant = {
  readonly credentialId: string;
  readonly personId: string;
  readonly expiresAt: string;
};

export type CredentialResource = {
  readonly kind: 'credential';
  readonly credentialId: string;
  readonly area: JdArea;
  readonly bindings: readonly CredentialBinding[];
  readonly usedBy: CredentialBinding | null;
  readonly revealGrants: readonly RevealGrant[];
};

const credentialRuleByCapability: ReadonlyMap<string, CredentialRule> = new Map(
  Object.entries(credentialRules),
);

function isPersonAtTheKeyboard(actor: Principal): boolean {
  return actor.kind === 'person' && actor.personId !== null && actor.interactive;
}

function grantReachesCredential(
  grant: Grant,
  rule: CredentialRule,
  credential: CredentialResource,
): boolean {
  if (grant.scopeKind === 'org') return rule.orgAdmin && reaches(grant.role, minimumRole.admin);
  return grant.scopeArea === credential.area && reaches(grant.role, rule.area);
}

function isUsedWhereBound(credential: CredentialResource): boolean {
  const used = credential.usedBy;
  if (used === null) return false;
  return credential.bindings.some(
    (binding) => binding.harnessId === used.harnessId && binding.connectorKey === used.connectorKey,
  );
}

function holdsRevealGrant(actor: Principal, credential: CredentialResource, at: Date): boolean {
  return credential.revealGrants.some(
    (grant) =>
      grant.credentialId === credential.credentialId &&
      grant.personId === actor.personId &&
      new Date(grant.expiresAt).getTime() > at.getTime(),
  );
}

function reachesCredential(
  actor: Principal,
  capability: string,
  credential: CredentialResource,
  at: Date,
): boolean {
  const rule = credentialRuleByCapability.get(capability);
  if (rule === undefined) return false;
  if (rule.person && !isPersonAtTheKeyboard(actor)) return false;
  if (capability === 'use' && !isUsedWhereBound(credential)) return false;
  if (capability === 'reveal' && !holdsRevealGrant(actor, credential, at)) return false;
  return actor.grants.some(
    (grant) => isLive(grant, at) && grantReachesCredential(grant, rule, credential),
  );
}

export function managesOwnArea(
  actor: Principal,
  credential: CredentialResource,
  at: Date,
): boolean {
  if (!isPersonAtTheKeyboard(actor)) return false;
  return actor.grants.some(
    (grant) =>
      isLive(grant, at) &&
      grant.scopeKind === 'jd_area' &&
      grant.scopeArea === credential.area &&
      reaches(grant.role, credentialRules.manage.area),
  );
}

export type PersonResource = {
  readonly kind: 'person';
  readonly personId: string;
  readonly status: PersonStatus;
};

function holdsAnyRead(actor: Principal, at: Date): boolean {
  return actor.grants.some((grant) => isLive(grant, at) && readScope(grant) !== null);
}

function isOrgAdmin(actor: Principal, at: Date): boolean {
  return actor.grants.some(
    (grant) =>
      isLive(grant, at) && grant.scopeKind === 'org' && reaches(grant.role, minimumRole.admin),
  );
}

function readsPersonRecord(actor: Principal, person: PersonResource, at: Date): boolean {
  if (actor.kind !== 'person' || actor.personId === null) return false;
  if (actor.personId === person.personId || isOrgAdmin(actor, at)) return true;
  return person.status === 'active' && holdsAnyRead(actor, at);
}

const aclActions: ReadonlySet<string> = new Set(Object.keys(minimumRole));

function isAclAction(action: AclAction | CredentialCapability): action is AclAction {
  return aclActions.has(action);
}

export function can(
  actor: Principal,
  action: AclAction | CredentialCapability,
  resource: AclResource | RowResource | CredentialResource | PersonResource,
  at: Date,
): boolean {
  if (resource.kind === 'credential') return reachesCredential(actor, action, resource, at);
  if (resource.kind === 'person')
    return action === 'read' && readsPersonRecord(actor, resource, at);
  if (!isAclAction(action)) return false;
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

export type PropertyRule = {
  readonly steward: JdArea | null;
  readonly role: Role;
  readonly owner: boolean;
};

export type PropertyAccess = 'all' | 'own' | 'none';

function holdsOrgAdmin(actor: Principal, at: Date): boolean {
  return actor.grants.some(
    (grant) =>
      isLive(grant, at) && grant.scopeKind === 'org' && reaches(grant.role, minimumRole.admin),
  );
}

function holdsAreaRole(actor: Principal, area: JdArea, role: Role, at: Date): boolean {
  return actor.grants.some(
    (grant) =>
      isLive(grant, at) &&
      grant.scopeKind === 'jd_area' &&
      grant.scopeArea === area &&
      reaches(grant.role, role),
  );
}

export function propertyAccess(
  actor: Principal,
  rule: PropertyRule | null,
  rowArea: JdArea,
  at: Date,
): PropertyAccess {
  if (rule === null) return 'all';
  if (holdsOrgAdmin(actor, at)) return 'all';
  if (holdsAreaRole(actor, rule.steward ?? rowArea, rule.role, at)) return 'all';
  if (rule.owner && actor.kind === 'person' && actor.personId !== null) return 'own';
  return 'none';
}

export function canReadProperty(
  actor: Principal,
  rule: PropertyRule | null,
  row: { readonly area: JdArea; readonly ownerId: string | null },
  at: Date,
): boolean {
  const access = propertyAccess(actor, rule, row.area, at);
  if (access === 'all') return true;
  return access === 'own' && row.ownerId !== null && row.ownerId === actor.personId;
}
