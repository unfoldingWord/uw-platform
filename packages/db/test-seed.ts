import { eq, sql } from 'drizzle-orm';
import type { CapabilityWord, PageStatus, PageType, Role, Scope } from '@uw/contracts';
import type { AnyExecutor } from './any-database.ts';
import {
  delegations,
  grantAudit,
  harnessEvents,
  harnessItems,
  harnessStages,
  harnesses,
  pages,
  people,
  roleGrants,
} from './schema.ts';

export type SeedPerson = {
  readonly id: string;
  readonly email: string;
  readonly status?: 'active' | 'pending';
};

export type SeedGrant = {
  readonly id: string;
  readonly personId: string;
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: string | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export async function seedPerson(db: AnyExecutor, person: SeedPerson): Promise<void> {
  await db.insert(people).values({
    id: person.id,
    email: person.email,
    displayName: person.email,
    status: person.status ?? 'active',
  });
}

export async function seedGrant(db: AnyExecutor, grant: SeedGrant): Promise<void> {
  await db.insert(roleGrants).values({ ...grant });
}

export async function revokeSeededGrant(db: AnyExecutor, grantId: string, at: Date): Promise<void> {
  await db.update(roleGrants).set({ revokedAt: at }).where(eq(roleGrants.id, grantId));
}

export async function rewriteGrantAudit(db: AnyExecutor, actor: string): Promise<void> {
  await db.update(grantAudit).set({ actor });
}

export async function rewriteDelegation(
  db: AnyExecutor,
  delegationId: string,
  change: { readonly capability?: CapabilityWord; readonly harnessId?: string },
): Promise<void> {
  await db.update(delegations).set(change).where(eq(delegations.id, delegationId));
}

export async function rewritePageFrontmatter(
  db: AnyExecutor,
  pageId: string,
  frontmatter: Readonly<Record<string, unknown>>,
): Promise<void> {
  await db.update(pages).set({ frontmatter }).where(eq(pages.id, pageId));
}

export async function activateSeededPage(db: AnyExecutor, pageId: string): Promise<void> {
  await db
    .update(pages)
    .set({ status: 'active', version: sql`${pages.version} + 1` })
    .where(eq(pages.id, pageId));
}

const seededAt = new Date('2026-10-01T09:00:00.000Z');
const seededActor = 'human:00000000-0000-4000-8000-000000000001';
const seededTrace = '00000000-0000-4000-8000-0000000000e1';

export type SeedEvent = {
  readonly harnessId: string;
  readonly n: number;
  readonly itemId?: string;
  readonly name?: string;
  readonly actor?: string;
  readonly position?: number;
};

export function seededEventId(harnessId: string, n: number): string {
  return `00000000-0000-4000-9000-${harnessId.slice(-4)}${n.toString(16).padStart(8, '0')}`;
}

export async function seedHarness(
  db: AnyExecutor,
  harness: { readonly id: string; readonly key: string; readonly jdArea: string },
): Promise<void> {
  await db.insert(harnesses).values({ ...harness, template: 'software', createdAt: seededAt });
}

export async function seedItem(
  db: AnyExecutor,
  item: { readonly id: string; readonly harnessId: string; readonly stageId: string },
): Promise<void> {
  await db.insert(harnessStages).values({
    id: item.stageId,
    harnessId: item.harnessId,
    key: 'ship',
    title: 'Stage',
    position: 1,
    bracket: 'deploy_package',
    agentPickup: 'none',
    exitGate: 'human_approval',
  });
  await db.insert(harnessItems).values({ ...item, title: 'Item', createdAt: seededAt });
}

export async function seedEvent(db: AnyExecutor, event: SeedEvent): Promise<void> {
  await db.insert(harnessEvents).values({
    id: seededEventId(event.harnessId, event.n),
    harnessId: event.harnessId,
    itemId: event.itemId ?? null,
    ...(event.position === undefined ? {} : { position: event.position }),
    name: event.name ?? 'item_created',
    actor: event.actor ?? seededActor,
    evidence: {},
    traceId: seededTrace,
    at: seededAt,
  });
}

export type SeedPage = {
  readonly id: string;
  readonly type: PageType;
  readonly status: PageStatus;
  readonly jdArea: string;
  readonly bodyMd: string;
  readonly slug: string;
  readonly title: string;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
  readonly parentId?: string | null;
};

export async function seedPage(db: AnyExecutor, page: SeedPage): Promise<void> {
  await db.insert(pages).values({ parentId: null, frontmatter: {}, ...page, version: 1 });
}
