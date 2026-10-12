import { ingestIdentity, principalSchema, type IssueRef, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { bml, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simIngest,
  simPerson,
  simSystem,
} from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const issue: IssueRef = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };
const updatedAt = '2026-10-02T09:00:00.000Z';

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly editor: Principal;
  readonly viewer: Principal;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    const editor = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const viewer = await simPerson(world, 3, [
      { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    await work({ world, harnessId: harness.id, editor, viewer });
  } finally {
    await world.close();
  }
}

function importAs(scene: Scene, actor: Principal, overrides: Partial<{ issue: IssueRef }> = {}) {
  return scene.world.kernel.items.importIssue(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    issue: overrides.issue ?? issue,
    title: 'Wire the board',
    pageId: null,
  });
}

function removeAs(scene: Scene, caller: Caller, label: string, githubId = issue.githubId) {
  return scene.world.kernel.items.labelRemoved(caller, {
    githubId,
    label,
    githubUpdatedAt: updatedAt,
  });
}

async function itemCount(scene: Scene): Promise<number> {
  const items = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.forHarness(scene.harnessId),
  );
  return items.length;
}

function forgedIngest(owner: Principal): Principal {
  return principalSchema.parse({
    identity: ingestIdentity,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: owner.grants,
    interactive: false,
  });
}

function device(owner: Principal): Principal {
  return simAgent(owner, `${owner.personId}/claude`, { interactive: true });
}

async function hidesBindingFromStranger(scene: Scene): Promise<void> {
  const stranger = await simPerson(scene.world, 4, []);
  const elsewhere = { ...issue, repo: 'unfoldingWord/other' };
  const refusal = {
    status: 'error',
    reason: 'not_permitted',
    detail: { harnessId: scene.harnessId },
  };
  expect(await importAs(scene, stranger, { issue: elsewhere })).toEqual(refusal);
  expect(await importAs(scene, stranger)).toEqual(refusal);
  expect(await itemCount(scene)).toBe(0);
}

async function refusesMalformedRemoval(scene: Scene): Promise<void> {
  await importAs(scene, simIngest());
  const ingest = simCaller(scene.world, simIngest());
  expect(await removeAs(scene, ingest, 'h'.repeat(51))).toEqual({
    status: 'error',
    reason: 'malformed_command',
    detail: { githubId: issue.githubId, field: 'label' },
  });
  const undated = await scene.world.kernel.items.labelRemoved(ingest, {
    githubId: issue.githubId,
    label: 'harness',
    githubUpdatedAt: 'yesterday',
  });
  expect(undated).toEqual({
    status: 'error',
    reason: 'malformed_command',
    detail: { githubId: issue.githubId, field: 'githubUpdatedAt' },
  });
  expect(await removeAs(scene, ingest, 'harness')).toMatchObject({
    value: { recorded: true },
  });
}

describe("GH-3 only the ingest principal or a writer on the area imports, onto the harness of the issue's repository", () => {
  it('refuses an agent device with editor and a viewer person, and creates nothing', () =>
    inScene(async (scene) => {
      expect(await importAs(scene, device(scene.editor))).toEqual({
        status: 'error',
        reason: 'not_permitted',
        detail: { harnessId: scene.harnessId },
      });
      expect(await importAs(scene, scene.viewer)).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
      });
      expect(await itemCount(scene)).toBe(0);
    }));

  it('refuses the ingest identity carried by a person or with grants', () =>
    inScene(async (scene) => {
      const forged = forgedIngest(scene.editor);
      expect(await importAs(scene, forged)).toMatchObject({ reason: 'not_permitted' });
      expect(await removeAs(scene, simCaller(scene.world, forged), 'harness')).toMatchObject({
        reason: 'not_permitted',
      });
      expect(
        await scene.world.kernel.reads.importTarget(simCaller(scene.world, forged), {
          repository: 'unfoldingWord/uw-platform',
        }),
      ).toMatchObject({ reason: 'harness_not_found' });
      expect(await itemCount(scene)).toBe(0);
    }));

  it('answers a person without grants alike whether or not the repository is bound', () =>
    inScene(hidesBindingFromStranger));

  it('refuses an issue in another repository with a closed-set reason, even from the ingest principal', () =>
    inScene(async (scene) => {
      const elsewhere = { ...issue, repo: 'unfoldingWord/other' };
      for (const actor of [simIngest(), scene.editor]) {
        expect(await importAs(scene, actor, { issue: elsewhere })).toEqual({
          status: 'error',
          reason: 'not_permitted',
          detail: { harnessId: scene.harnessId, why: 'repository_mismatch' },
        });
      }
      expect(await itemCount(scene)).toBe(0);
    }));
});

describe('GH-3 an issue on no harness of its repository creates nothing, and an allowed import makes one item', () => {
  it('creates nothing on a harness bound to no repository, or on no harness at all', () =>
    inScene(async (scene) => {
      const { harness } = await createSimHarness(scene.world, bml, { jdArea: '80-89' });
      const unbound = { ...scene, harnessId: harness.id };
      expect(await importAs(unbound, simIngest())).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
        detail: { why: 'repository_mismatch' },
      });
      const missing = { ...scene, harnessId: '00000000-0000-4000-8000-000000003999' };
      expect(await importAs(missing, simIngest())).toMatchObject({
        reason: 'harness_not_found',
      });
      expect(await itemCount(unbound)).toBe(0);
    }));

  it('lets the ingest principal, the system principal and an editor import the one item', () =>
    inScene(async (scene) => {
      const first = await importAs(scene, simIngest());
      expect(first).toMatchObject({ status: 'accepted', value: { created: true } });
      for (const actor of [simSystem(), scene.editor]) {
        expect(await importAs(scene, actor)).toEqual({
          status: 'accepted',
          value: { item: first.status === 'accepted' ? first.value.item : null, created: false },
        });
      }
      expect(await itemCount(scene)).toBe(1);
    }));
});

describe('the import target is the harness bound to the repository, hidden from anyone else', () => {
  it('answers the software harness and its area for a repository named in another case', () =>
    inScene(async (scene) => {
      for (const actor of [simIngest(), scene.viewer]) {
        expect(
          await scene.world.kernel.reads.importTarget(simCaller(scene.world, actor), {
            repository: 'UnfoldingWord/UW-Platform',
          }),
        ).toEqual({ status: 'accepted', value: { harnessId: scene.harnessId, jdArea: '80-89' } });
      }
    }));

  it('answers harness_not_found for another repository, for an agent and for a person without read', () =>
    inScene(async (scene) => {
      const stranger = await simPerson(scene.world, 4, []);
      const asks: readonly [Principal, string][] = [
        [simIngest(), 'unfoldingWord/other'],
        [device(scene.editor), 'unfoldingWord/uw-platform'],
        [stranger, 'unfoldingWord/uw-platform'],
      ];
      for (const [actor, repository] of asks) {
        expect(
          await scene.world.kernel.reads.importTarget(simCaller(scene.world, actor), {
            repository,
          }),
        ).toMatchObject({ status: 'error', reason: 'harness_not_found' });
      }
    }));
});

describe('GH-3 only the ingest principal records a removed label, once per item', () => {
  it('answers item_not_found for an issue with no item', () =>
    inScene(async (scene) => {
      expect(
        await removeAs(scene, simCaller(scene.world, simIngest()), 'harness', 9100000099),
      ).toEqual({ status: 'error', reason: 'item_not_found', detail: { githubId: 9100000099 } });
    }));

  it('refuses a person and an agent device, recording nothing', () =>
    inScene(async (scene) => {
      await importAs(scene, simIngest());
      for (const actor of [scene.editor, device(scene.editor)]) {
        expect(await removeAs(scene, simCaller(scene.world, actor), 'harness')).toMatchObject({
          status: 'error',
          reason: 'not_permitted',
        });
      }
      const ingest = simCaller(scene.world, simIngest());
      expect(await removeAs(scene, ingest, 'harness')).toMatchObject({
        value: { recorded: true },
      });
    }));

  it('refuses a label over 50 characters or an update time that is not an instant', () =>
    inScene(refusesMalformedRemoval));

  it('records nothing a second time, whatever the case of the label or the time of the retry', () =>
    inScene(async (scene) => {
      await importAs(scene, simIngest());
      const ingest = simCaller(scene.world, simIngest());
      expect(await removeAs(scene, ingest, 'harness')).toMatchObject({
        value: { recorded: true, item: { stageKey: 'package' } },
      });
      expect(await removeAs(scene, ingest, 'Harness')).toMatchObject({
        value: { recorded: false, item: { stageKey: 'package' } },
      });
      const later = await scene.world.kernel.items.labelRemoved(ingest, {
        githubId: issue.githubId,
        label: 'HARNESS',
        githubUpdatedAt: '2026-10-03T09:00:00.000Z',
      });
      expect(later).toMatchObject({ value: { recorded: false } });
      expect(await itemCount(scene)).toBe(1);
    }));
});

async function answersWhetherImported(scene: Scene): Promise<void> {
  const ingest = simCaller(scene.world, simIngest());
  const ask = (caller: Caller) =>
    scene.world.kernel.reads.issueImported(caller, { githubId: issue.githubId });
  expect(await ask(ingest)).toEqual({ status: 'accepted', value: false });
  await importAs(scene, simIngest());
  expect(await ask(ingest)).toEqual({ status: 'accepted', value: true });
  expect(await ask(simCaller(scene.world, simSystem()))).toEqual({
    status: 'accepted',
    value: true,
  });
  for (const actor of [scene.editor, device(scene.editor)]) {
    expect(await ask(simCaller(scene.world, actor))).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { githubId: issue.githubId },
    });
  }
}

describe('only an import principal asks whether an issue already has an item', () => {
  it('answers false then true for the ingest principal, and refuses a person and a device', () =>
    inScene(answersWhetherImported));
});
