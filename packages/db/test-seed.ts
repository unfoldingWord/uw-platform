import { and, eq, ne, sql } from 'drizzle-orm';
import { platformFrontmatterSchema, platformPageSlug } from '@uw/contracts';
import type { CapabilityWord, PageStatus, PageType, Role, Scope } from '@uw/contracts';
import type { AnyExecutor } from './any-database.ts';
import {
  delegations,
  grantAudit,
  harnessEvents,
  harnessItems,
  harnessRuns,
  harnessStages,
  harnesses,
  pages,
  pageVersions,
  people,
  personas,
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

export async function rewriteHarnessRepository(
  db: AnyExecutor,
  harnessId: string,
  repository: string | null,
): Promise<void> {
  await db.update(harnesses).set({ repository }).where(eq(harnesses.id, harnessId));
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

export async function rewriteRunDelegation(
  db: AnyExecutor,
  runId: string,
  delegationId: string,
): Promise<void> {
  await db.update(harnessRuns).set({ delegationId }).where(eq(harnessRuns.id, runId));
}

export async function activateSeededPage(db: AnyExecutor, pageId: string): Promise<void> {
  await db
    .update(pages)
    .set({ status: 'active', version: sql`${pages.version} + 1` })
    .where(eq(pages.id, pageId));
}

export async function rewritePageStatus(
  db: AnyExecutor,
  pageId: string,
  status: PageStatus,
): Promise<void> {
  await db
    .update(pages)
    .set({ status, version: sql`${pages.version} + 1` })
    .where(eq(pages.id, pageId));
}

export async function rewritePageBody(
  db: AnyExecutor,
  pageId: string,
  bodyMd: string,
): Promise<void> {
  await db
    .update(pages)
    .set({ bodyMd, version: sql`${pages.version} + 1` })
    .where(eq(pages.id, pageId));
}

export async function resaveSeededPage(db: AnyExecutor, pageId: string): Promise<void> {
  await db
    .update(pages)
    .set({ version: sql`${pages.version} + 1` })
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

export type SeedBreakerReading = {
  readonly harnessId: string;
  readonly at: Date;
  readonly actor: string;
  readonly name?: 'breaker_open' | 'breaker_holding';
  readonly percent?: number;
};

export async function seedBreakerReading(
  db: AnyExecutor,
  reading: SeedBreakerReading,
): Promise<void> {
  const percent = reading.percent ?? 0;
  await db.insert(harnessEvents).values({
    id: crypto.randomUUID(),
    harnessId: reading.harnessId,
    itemId: null,
    name: reading.name ?? 'breaker_open',
    actor: reading.actor,
    evidence: { spentMinor: percent * 1250, capMinor: 125_000, currency: 'USD', percent },
    traceId: crypto.randomUUID(),
    at: reading.at,
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

export type SeedPlatformPage = {
  readonly id: string;
  readonly jdArea: string;
  readonly repositories: readonly string[];
};

export async function seedPlatformPage(db: AnyExecutor, seed: SeedPlatformPage): Promise<void> {
  const [held] = await db
    .select({ id: pages.id, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.jdArea, seed.jdArea), eq(pages.slug, platformPageSlug)));
  const listed = platformFrontmatterSchema.safeParse(held?.frontmatter);
  const before = listed.success ? listed.data.dispatch_allowed : [];
  const frontmatter = { dispatch_allowed: [...new Set([...before, ...seed.repositories])] };
  if (held !== undefined) {
    await db.update(pages).set({ frontmatter }).where(eq(pages.id, held.id));
    return;
  }
  await seedPage(db, {
    id: seed.id,
    type: 'platform',
    status: 'active',
    jdArea: seed.jdArea,
    slug: platformPageSlug,
    title: 'Platform',
    bodyMd: 'The repositories the platform may dispatch work onto.',
    frontmatter,
  });
}

export async function pageVersionsOf(db: AnyExecutor, pageId: string) {
  const rows = await db
    .select({
      version: pageVersions.version,
      status: pageVersions.status,
      editSource: pageVersions.editSource,
      traceId: pageVersions.traceId,
      frontmatterStatus: sql<unknown>`${pageVersions.frontmatter}->'status'`,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(pageVersions.version);
  return rows;
}

export async function dropDecisionNext(db: AnyExecutor, itemId: string): Promise<void> {
  await db.execute(
    sql`ALTER TABLE gate_decisions DISABLE TRIGGER gate_decisions_no_update_or_delete`,
  );
  await db.execute(
    sql`UPDATE gate_decisions SET evidence = evidence - 'next' WHERE item_id = ${itemId}`,
  );
  await db.execute(
    sql`ALTER TABLE gate_decisions ENABLE TRIGGER gate_decisions_no_update_or_delete`,
  );
}

export type SeedRun = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: string;
  readonly delegationId: string | null;
};

export async function seedHostedRun(db: AnyExecutor, run: SeedRun): Promise<void> {
  await db.insert(harnessRuns).values({
    ...run,
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    costBasis: 'metered',
    costMinor: 0,
    computeMinor: 0,
    traceId: seededTrace,
    outcome: 'running',
    startedAt: seededAt,
  });
}

export type SeedRunRow = typeof harnessRuns.$inferInsert;

export async function seedRunRow(db: AnyExecutor, run: SeedRunRow): Promise<void> {
  await db.insert(harnessRuns).values(run);
}

export type ItemRewrite = Partial<
  Pick<
    typeof harnessItems.$inferInsert,
    | 'claimedBy'
    | 'claimantKind'
    | 'leaseExpires'
    | 'riskTier'
    | 'riskDomains'
    | 'gateStatus'
    | 'prRepo'
    | 'prNumber'
    | 'zulipTopic'
  >
>;

export async function rewriteItem(
  db: AnyExecutor,
  itemId: string,
  change: ItemRewrite,
): Promise<void> {
  await db.update(harnessItems).set(change).where(eq(harnessItems.id, itemId));
}

export async function rewriteStagePaused(
  db: AnyExecutor,
  stage: { readonly harnessId: string; readonly key: string },
  paused: boolean,
): Promise<void> {
  await db
    .update(harnessStages)
    .set({ paused })
    .where(and(eq(harnessStages.harnessId, stage.harnessId), eq(harnessStages.key, stage.key)));
}

export type SeedEventRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly name: string;
  readonly actor: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly traceId: string;
  readonly at: Date;
};

export async function seedEventRows(db: AnyExecutor, rows: readonly SeedEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(harnessEvents)
    .values(rows.map((row) => ({ ...row, evidence: { ...row.evidence } })));
}

type OpenItems = {
  readonly harnessId: string;
  readonly stageKey: string;
  readonly count: number;
  readonly gateStatus?: 'working' | 'parked';
  readonly priority?: number;
};

export async function seedOpenItems(db: AnyExecutor, stage: OpenItems): Promise<void> {
  const gateStatus = stage.gateStatus ?? 'working';
  const priority = stage.priority ?? 0;
  await db.execute(sql`INSERT INTO harness_items (id, harness_id, stage_id, title, created_at, gate_status, priority)
    SELECT gen_random_uuid(), ${stage.harnessId}, harness_stages.id, 'Seeded item ' || n, ${seededAt.toISOString()}::timestamptz, ${gateStatus}, ${priority}
    FROM harness_stages, generate_series(1, ${stage.count}) AS n
    WHERE harness_stages.harness_id = ${stage.harnessId} AND harness_stages.key = ${stage.stageKey}`);
}

type LapsedDelegations = {
  readonly personId: string;
  readonly harnessId: string;
  readonly persona: string;
  readonly count: number;
  readonly lapsedAt: Date;
};

export async function seedLapsedDelegations(
  db: AnyExecutor,
  seed: LapsedDelegations,
): Promise<void> {
  const lapsedAt = seed.lapsedAt.toISOString();
  await db.execute(sql`INSERT INTO delegations (id, person_id, persona, harness_id, capability, granted_at, expires_at, lapsed_at, trace_id)
    SELECT gen_random_uuid(), ${seed.personId}, ${seed.persona}, ${seed.harnessId}, 'build', ${lapsedAt}::timestamptz - interval '1 hour', ${lapsedAt}::timestamptz + interval '1 day', ${lapsedAt}::timestamptz, gen_random_uuid()
    FROM generate_series(1, ${seed.count})`);
}

type GrantLostLapses = {
  readonly harnessId: string;
  readonly count: number;
  readonly at: Date;
};

export async function seedGrantLostLapses(db: AnyExecutor, seed: GrantLostLapses): Promise<void> {
  const at = seed.at.toISOString();
  await db.execute(sql`INSERT INTO harness_events (id, harness_id, name, actor, evidence, trace_id, at)
    SELECT gen_random_uuid(), ${seed.harnessId}, 'delegation_lapsed', 'agent:scout', jsonb_build_object('delegationId', gen_random_uuid()::text, 'why', 'grant_lost'), gen_random_uuid(), ${at}::timestamptz
    FROM generate_series(1, ${seed.count})`);
}

type HandOffs = {
  readonly harnessId: string;
  readonly personId: string;
  readonly count: number;
  readonly at: Date;
};

export async function seedHandOffs(db: AnyExecutor, seed: HandOffs): Promise<void> {
  const at = seed.at.toISOString();
  await db.execute(sql`INSERT INTO harness_events (id, harness_id, name, actor, evidence, trace_id, at)
    SELECT gen_random_uuid(), ${seed.harnessId}, 'handed_to_person', 'agent:reviewer', jsonb_build_object('personId', ${seed.personId}::text, 'why', 'review_rounds_exhausted', 'rounds', 3), gen_random_uuid(), ${at}::timestamptz
    FROM generate_series(1, ${seed.count})`);
}

async function upsertProjection(
  db: AnyExecutor,
  row: { readonly identity: string; readonly harnessId: string; readonly pageId: string },
): Promise<void> {
  await db
    .delete(personas)
    .where(and(eq(personas.pageId, row.pageId), ne(personas.identity, row.identity)));
  await db
    .insert(personas)
    .values(row)
    .onConflictDoUpdate({
      target: personas.identity,
      set: { harnessId: row.harnessId, pageId: row.pageId },
    });
}

export async function projectSeededPersona(db: AnyExecutor, pageId: string): Promise<void> {
  const [page] = await db.select().from(pages).where(eq(pages.id, pageId));
  if (page?.type !== 'persona' || page.status !== 'active') return;
  const frontmatter = page.frontmatter as Record<string, unknown>;
  const { identity, harness } = frontmatter;
  if (typeof identity !== 'string' || typeof harness !== 'string') return;
  const [known] = await db.select().from(harnesses).where(eq(harnesses.id, harness));
  if (known === undefined) return;
  await upsertProjection(db, { identity, harnessId: harness, pageId });
}

export type SeedActivePersona = {
  readonly identity: string;
  readonly harnessId: string;
  readonly pageId?: string;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
};

function seededPersonaFrontmatter(seed: SeedActivePersona): Record<string, unknown> {
  return {
    identity: seed.identity,
    owner: seededActor,
    harness: seed.harnessId,
    toolset: ['poll_queue', 'claim_item', 'record_run_step', 'submit_to_gate'],
    run_shape: 'external-run',
    engine: 'external',
    model: 'external',
    provider: null,
    budget: { monthly_minor: 0, currency: 'USD' },
    capability: 'build',
    requires_tools: ['poll_queue', 'claim_item', 'record_run_step', 'submit_to_gate'],
    ...seed.frontmatter,
    status: 'active',
  };
}

export async function seedActivePersona(db: AnyExecutor, seed: SeedActivePersona): Promise<void> {
  const [held] = await db.select().from(personas).where(eq(personas.identity, seed.identity));
  if (held?.harnessId === seed.harnessId && seed.pageId === undefined) return;
  const [harness] = await db.select().from(harnesses).where(eq(harnesses.id, seed.harnessId));
  if (harness === undefined) throw new Error(`no harness ${seed.harnessId} to seed a persona on`);
  const pageId = seed.pageId ?? crypto.randomUUID();
  const slug = seed.identity.slice('agent:'.length);
  await db.insert(pages).values({
    id: pageId,
    type: 'persona',
    jdArea: harness.jdArea,
    slug: `persona-${slug}-${pageId.slice(0, 8)}`,
    title: `Persona ${slug}`,
    parentId: null,
    frontmatter: seededPersonaFrontmatter(seed),
    bodyMd: `---\nname: ${slug}\ndescription: A seeded persona.\n---\nWork the item.`,
    version: 1,
    status: 'active',
  });
  await upsertProjection(db, { identity: seed.identity, harnessId: seed.harnessId, pageId });
}
