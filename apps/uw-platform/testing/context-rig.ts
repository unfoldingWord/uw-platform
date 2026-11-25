import { defaultCiChecks, principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { DEFAULT_SPEND_CAP, software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createAccessFixture, type AccessFixture } from './access-keys.ts';
import { kernelOn, personOn } from './kernel.ts';
import { callTool, httpClient } from './mcp.ts';
import { postgresDeps } from './postgres.ts';
import { callVerb } from '../mcp/dispatch.ts';
import { verbHandlers } from '../mcp/verbs/index.ts';

export const ROWAN = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'rowan.test@unfoldingword.org',
};
export const EDITOR = {
  id: '00000000-0000-4000-8000-000000001501',
  email: 'context-editor@unfoldingword.org',
};
export const VIEWER_80 = {
  id: '00000000-0000-4000-8000-000000001502',
  email: 'context-viewer-80@unfoldingword.org',
};
export const VIEWER_30 = {
  id: '00000000-0000-4000-8000-000000001503',
  email: 'context-viewer-30@unfoldingword.org',
};
export const PAGE = {
  item: '00000000-0000-4000-8000-000000001510',
  strategy: '00000000-0000-4000-8000-000000001511',
  itemLearning: '00000000-0000-4000-8000-000000001512',
  instructions: '00000000-0000-4000-8000-000000001513',
  instructionsLearning: '00000000-0000-4000-8000-000000001514',
  areaLearning: '00000000-0000-4000-8000-000000001515',
  suggestedLearning: '00000000-0000-4000-8000-000000001516',
  otherAreaLearning: '00000000-0000-4000-8000-000000001517',
  skill: '00000000-0000-4000-8000-000000001518',
  retired: '00000000-0000-4000-8000-000000001519',
  broken: '00000000-0000-4000-8000-000000001520',
};
const GRANTED_AT = new Date('2026-01-01T00:00:00.000Z');
const clock = { now: () => new Date() };

export type Body = Record<string, unknown>;
export type Tool = (name: string, args: Body) => Promise<Body>;
export type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly rowan: Principal;
  readonly harnessId: string;
  readonly itemIds: readonly string[];
  readonly packageItems: { readonly bare: string; readonly paged: string };
  readonly drop: () => Promise<void>;
};

function grant(n: number, personId: string, role: 'editor' | 'viewer', area: string) {
  return {
    id: `00000000-0000-4000-8000-0000000015${String(n).padStart(2, '0')}`,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: GRANTED_AT,
    expiresAt: null,
  };
}

export function learning(asOf: string, confidence: string) {
  return { confidence, as_of: asOf, supersedes: [], review_by: null };
}

export function page(id: string, overrides: Partial<SeedPage>): SeedPage {
  return {
    id,
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    slug: `context-${id.slice(-4)}`,
    title: `Page ${id.slice(-4)}`,
    bodyMd: 'Context.',
    frontmatter: { owner: `human:${EDITOR.id}`, summary: 'A product.' },
    ...overrides,
  };
}

const scopeSkill = { name: 'scope', description: 'How to scope an item.' };
const strategyFrontmatter = { niche: 'Translators', hypothesis: 'They need help.' };

const seededPages: readonly SeedPage[] = [
  page(PAGE.item, {}),
  page(PAGE.instructions, { type: 'skill', frontmatter: scopeSkill }),
  page(PAGE.strategy, {
    type: 'product_strategy',
    parentId: PAGE.item,
    frontmatter: strategyFrontmatter,
  }),
  page(PAGE.itemLearning, {
    type: 'learning',
    parentId: PAGE.item,
    frontmatter: learning('2026-09-01', 'observed'),
  }),
  page(PAGE.instructionsLearning, {
    type: 'learning',
    parentId: PAGE.instructions,
    frontmatter: learning('2026-09-20', 'confirmed'),
  }),
  page(PAGE.areaLearning, { type: 'learning', frontmatter: learning('2026-09-30', 'inferred') }),
  page(PAGE.otherAreaLearning, {
    type: 'learning',
    jdArea: '30-39',
    parentId: PAGE.item,
    frontmatter: learning('2026-09-10', 'observed'),
  }),
  page(PAGE.skill, {
    type: 'skill',
    parentId: PAGE.item,
    frontmatter: { name: 'run-workshop', description: 'How to run a workshop.' },
  }),
  page(PAGE.retired, {
    type: 'product_strategy',
    status: 'retired',
    parentId: PAGE.item,
    frontmatter: strategyFrontmatter,
  }),
  page(PAGE.suggestedLearning, {
    type: 'learning',
    status: 'suggested',
    frontmatter: learning('2026-10-01', 'assumed'),
  }),
];

async function seedWorld(db: Database): Promise<void> {
  await seedPerson(db, EDITOR);
  await seedPerson(db, VIEWER_80);
  await seedPerson(db, VIEWER_30);
  await seedGrant(db, grant(20, EDITOR.id, 'editor', '80-89'));
  await seedGrant(db, grant(21, VIEWER_80.id, 'viewer', '80-89'));
  await seedGrant(db, grant(22, VIEWER_30.id, 'viewer', '30-39'));
  for (const seeded of seededPages) await seedPage(db, seeded);
}

export function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

export function value<T>(
  outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string },
) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function itemInScope(kernel: Kernel, rowan: Principal, harnessId: string, n: number) {
  const input = { harnessId, title: `Item ${n}`, pageId: PAGE.item, priority: n, due: null };
  const { itemId } = value(
    await kernel.items.enqueue(caller(rowan), { ...input, delegationId: null }),
  );
  value(await kernel.items.claim(caller(rowan), { itemId, delegationId: null }));
  const submit = { itemId, to: null, evidence: {}, change: null };
  value(await kernel.items.submit(caller(rowan), submit));
  return itemId;
}

export async function itemInPackage(
  kernel: Kernel,
  rowan: Principal,
  harnessId: string,
  pageId: string | null,
  priority = 0,
) {
  const input = { harnessId, title: 'Package item', pageId, priority, due: null };
  return value(await kernel.items.enqueue(caller(rowan), { ...input, delegationId: null })).itemId;
}

export function activationOf(harnessId: string, harnessKey: string) {
  const repository = harnessKey === 'software' ? 'unfoldingWord/uw-platform' : null;
  const requiredChecks = harnessKey === 'software' ? [...defaultCiChecks] : [];
  return { harnessId, harnessKey, jdArea: '80-89', template: software, repository, requiredChecks };
}

async function seedHarness(kernel: Kernel, rowan: Principal) {
  const harnessId = crypto.randomUUID();
  value(await kernel.stages.activate(caller(rowan), activationOf(harnessId, 'software')));
  const change = { instructionsPageId: PAGE.instructions };
  value(await kernel.stages.updateStage(caller(rowan), { harnessId, stageKey: 'scope', change }));
  const itemIds = [
    await itemInScope(kernel, rowan, harnessId, 1),
    await itemInScope(kernel, rowan, harnessId, 2),
  ];
  const packageItems = {
    bare: await itemInPackage(kernel, rowan, harnessId, null),
    paged: await itemInPackage(kernel, rowan, harnessId, PAGE.item),
  };
  return { harnessId, itemIds, packageItems };
}

export async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedWorld(db);
  const kernel = kernelOn(db, clock);
  const rowan = await personOn(db, ROWAN.id, ROWAN.email, new Date());
  const scene = await seedHarness(kernel, rowan);
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, fixture: await createAccessFixture(), kernel, rowan, ...scene, drop };
}

export async function runner(r: Rig, email: string): Promise<Tool> {
  const token = await r.fixture.signForMcp({ email });
  const client = await httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  return async (name, args) => (await callTool(client, name, args)).body;
}

function bodyOf(text: string): Body {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

export async function viewer(
  r: Rig,
  person: { id: string; email: string },
  lines: string[] = [],
): Promise<Tool> {
  const human = await personOn(r.db, person.id, person.email, new Date());
  const principal = principalSchema.parse({
    ...human,
    identity: `agent:${person.id}/laptop`,
    kind: 'agent',
    email: null,
  });
  const logger = createLogger(
    { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
    (line) => lines.push(line),
  );
  return async (name, args) => {
    const context = {
      principal,
      host: 'external' as const,
      at: new Date(),
      traceId: crypto.randomUUID(),
      kernel: r.kernel,
      db: r.db,
      commit: 'test-commit',
      cap: DEFAULT_SPEND_CAP,
      logger,
    };
    const [block] = (await callVerb(context, name, args, verbHandlers)).content;
    return bodyOf(block?.type === 'text' ? block.text : '{}');
  };
}

export function summary(id: string, type = 'product', jdArea = '80-89'): Body {
  return {
    id,
    type,
    jdArea,
    slug: `context-${id.slice(-4)}`,
    title: `Page ${id.slice(-4)}`,
    status: 'active',
  };
}

export const itemLearning = {
  page: summary(PAGE.itemLearning, 'learning'),
  confidence: 'observed',
  asOf: '2026-09-01',
};
export const laterTiers = [
  {
    page: summary(PAGE.instructionsLearning, 'learning'),
    confidence: 'confirmed',
    asOf: '2026-09-20',
  },
  { page: summary(PAGE.areaLearning, 'learning'), confidence: 'inferred', asOf: '2026-09-30' },
];
