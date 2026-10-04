import { describe, expect, it } from 'vitest';
import type { Identity } from '@uw/contracts';
import type { Store } from '../ports.ts';
import type { SeededPage } from './store-gateways.ts';
import { seedHarness, uid } from './store-gateway-fixtures.ts';

export type PageVersionRow = {
  readonly version: number;
  readonly status: string;
  readonly editSource: string;
  readonly traceId: string | null;
  readonly frontmatterStatus: unknown;
};

type PersonasSubject = () => {
  readonly store: Store;
  seedPage(page: SeededPage): Promise<void>;
  pageVersions(pageId: string): Promise<readonly PageVersionRow[]>;
};

const admin = 'human:00000000-0000-4000-8000-000000000001' as Identity;
const traceId = uid(0x60ff);

function personaFrontmatter(harnessBase: number, identity: string) {
  return {
    identity,
    owner: admin,
    harness: uid(harnessBase),
    toolset: ['read_page'],
    run_shape: 'workflow-run',
    engine: 'openrouter-messages',
    model: 'z-ai/glm-5.3',
    provider: 'z-ai',
    budget: { monthly_minor: 5000, currency: 'USD' },
    capability: 'build',
    requires_tools: ['read_page'],
    status: 'suggested',
  };
}

function pageOf(
  base: number,
  n: number,
  page: Partial<SeededPage>,
  frontmatter: Readonly<Record<string, unknown>> = {},
): SeededPage {
  return {
    id: uid(base + 0x20 + n),
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    title: `Persona ${n}`,
    bodyMd: 'body',
    slug: `gateway-personas-${base.toString(16)}-${n}`,
    ...page,
    frontmatter: { ...personaFrontmatter(base, `agent:p${n}`), ...frontmatter },
  };
}

function describeFlip(subject: PersonasSubject): void {
  it('activatePersona flips a suggested persona at the expected version and snapshots it', async () => {
    await subject().store.transaction((tx) => seedHarness(tx, 0x6000, 'gateway-personas-flip'));
    const page = pageOf(0x6000, 1, {});
    await subject().seedPage(page);
    const flipped = await subject().store.transaction((tx) =>
      tx.pages.write.activatePersona({
        pageId: page.id,
        expectedVersion: 1,
        editSource: admin,
        traceId,
      }),
    );
    expect(flipped).toMatchObject({ id: page.id, status: 'active', version: 2 });
    expect(flipped?.frontmatter['status']).toBe('active');
    expect(flipped?.frontmatter['identity']).toBe('agent:p1');
    expect(await subject().pageVersions(page.id)).toEqual([
      { version: 2, status: 'active', editSource: admin, traceId, frontmatterStatus: 'active' },
    ]);
  });

  it('activatePersona answers null for a stale version, an active page or another type, and changes nothing', async () => {
    await subject().store.transaction((tx) => seedHarness(tx, 0x6080, 'gateway-personas-stale'));
    const suggested = pageOf(0x6080, 1, {});
    const active = pageOf(0x6080, 2, { status: 'active' }, { status: 'active' });
    const learning = pageOf(0x6080, 3, { type: 'learning' }, {});
    for (const page of [suggested, active, learning]) await subject().seedPage(page);
    const flip = (pageId: string, expectedVersion: number) =>
      subject().store.transaction((tx) =>
        tx.pages.write.activatePersona({ pageId, expectedVersion, editSource: admin, traceId }),
      );
    expect(await flip(suggested.id, 2)).toBeNull();
    expect(await flip(active.id, 1)).toBeNull();
    expect(await flip(learning.id, 1)).toBeNull();
    expect(await flip(uid(0x60fe), 1)).toBeNull();
    const after = await subject().store.transaction((tx) =>
      tx.pages.read.facts([suggested.id, active.id, learning.id]),
    );
    expect(after.map((page) => [page.status, page.version])).toEqual([
      ['suggested', 1],
      ['active', 1],
      ['suggested', 1],
    ]);
    for (const page of [suggested, active, learning]) {
      expect(await subject().pageVersions(page.id)).toEqual([]);
    }
  });
}

function describeProjectionUpsert(subject: PersonasSubject): void {
  it('the projection upserts on identity, moves a page to a new identity, and answers the active page', async () => {
    await subject().store.transaction((tx) => seedHarness(tx, 0x6100, 'gateway-personas-proj'));
    const one = pageOf(
      0x6100,
      1,
      { status: 'active' },
      { identity: 'agent:proj', status: 'active' },
    );
    const two = pageOf(
      0x6100,
      2,
      { status: 'active' },
      { identity: 'agent:proj', status: 'active' },
    );
    for (const page of [one, two]) await subject().seedPage(page);
    const identity = 'agent:proj' as Identity;
    const renamed = 'agent:proj-renamed' as Identity;
    const harnessId = uid(0x6100);
    const read = await subject().store.transaction(async (tx) => {
      await tx.personas.write.upsert({ identity, harnessId, pageId: one.id });
      const first = await tx.personas.read.active(identity, harnessId);
      await tx.personas.write.upsert({ identity, harnessId, pageId: two.id });
      const second = await tx.personas.read.byIdentity(identity);
      const active = await tx.personas.read.active(identity, harnessId);
      await tx.personas.write.upsert({ identity: renamed, harnessId, pageId: two.id });
      return {
        first: first?.id,
        second,
        active: active?.id,
        old: await tx.personas.read.byIdentity(identity),
        moved: await tx.personas.read.byIdentity(renamed),
        missing: await tx.personas.read.byIdentity('agent:nobody' as Identity),
      };
    });
    expect(read).toEqual({
      first: one.id,
      second: { identity, harnessId, pageId: two.id },
      active: two.id,
      old: null,
      moved: { identity: renamed, harnessId, pageId: two.id },
      missing: null,
    });
  });
}

function droppedRows(): readonly (readonly [Identity, SeededPage])[] {
  const active = { status: 'active' } as const;
  const named: readonly [string, Partial<SeededPage>, Readonly<Record<string, unknown>>][] = [
    ['agent:retired', { status: 'retired' }, { identity: 'agent:retired' }],
    ['agent:renamed', active, { identity: 'agent:elsewhere' }],
    ['agent:moved', active, { identity: 'agent:moved', harness: uid(0x6200) }],
    ['agent:broken', active, { identity: 'agent:broken', toolset: 'all' }],
    ['agent:held', active, { identity: 'agent:held', status: 'active' }],
  ];
  return named.map(([identity, page, frontmatter], index) => [
    identity as Identity,
    pageOf(0x6180, index + 1, page, frontmatter),
  ]);
}

function describeProjectionDrops(subject: PersonasSubject): void {
  it('the projection answers nothing for a retired page or one whose frontmatter names another identity or harness', async () => {
    await subject().store.transaction(async (tx) => {
      await seedHarness(tx, 0x6180, 'gateway-personas-drop');
      await seedHarness(tx, 0x6200, 'gateway-personas-other');
    });
    const harnessId = uid(0x6180);
    const rows = droppedRows();
    for (const [, page] of rows) await subject().seedPage(page);
    const read = await subject().store.transaction(async (tx) => {
      for (const [identity, page] of rows) {
        await tx.personas.write.upsert({ identity, harnessId, pageId: page.id });
      }
      const active = (identity: string, harness = harnessId) =>
        tx.personas.read.active(identity as Identity, harness).then((page) => page?.id ?? null);
      return [
        await active('agent:retired'),
        await active('agent:renamed'),
        await active('agent:moved'),
        await active('agent:broken'),
        await active('agent:held', uid(0x6200)),
        await active('agent:held'),
      ];
    });
    expect(read).toEqual([null, null, null, null, null, rows[4]?.[1].id]);
  });
}

export function describeStorePersonas(adapter: string, subject: PersonasSubject): void {
  describe(`DX-3 store pages and personas gateways on ${adapter}`, () => {
    describeFlip(subject);
    describeProjectionUpsert(subject);
    describeProjectionDrops(subject);
  });
}
