import type { HarnessEvent, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant, seedGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const hour = 3_600_000;
const day = 24 * hour;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly kim: Principal;
  readonly lee: Principal;
  readonly max: Principal;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const lee = await simPerson(world, 5, [{ role: 'admin', ...area }]);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    await work({ world, harnessId: harness.id, kim, lee, max });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function grantAs(scene: Scene, actor: Principal, persona = 'agent:iterate', expiresAt?: Date) {
  return scene.world.kernel.delegations.grant(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    persona,
    capability: 'iterate',
    expiresAt: expiresAt ?? null,
    supersedes: null,
  });
}

function agentOf(scene: Scene, owner: Principal, persona = 'iterate'): Caller {
  return simCaller(scene.world, simAgent(owner, persona, { interactive: false }));
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

function lapseWhy(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail['why'] : null;
}

async function logOf(scene: Scene, name: string): Promise<readonly HarnessEvent[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === name);
}

function rowOf(scene: Scene, delegationId: string) {
  return scene.world.adapters.store.transaction((tx) => tx.delegations.read.byId(delegationId));
}

function nowOf(scene: Scene): Date {
  return scene.world.adapters.clock.now();
}

describe('KN-16 who may grant a delegation', () => {
  sceneIt('refuses an agent and an area editor, and records nothing', async (scene) => {
    const byAgent = await scene.world.kernel.delegations.grant(agentOf(scene, scene.kim), {
      harnessId: scene.harnessId,
      persona: 'agent:iterate',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    });
    const byEditor = await grantAs(scene, scene.max);
    expect([reasonOf(byAgent), reasonOf(byEditor)]).toEqual(['not_permitted', 'not_permitted']);
    expect(await logOf(scene, 'delegation_granted')).toEqual([]);
  });

  sceneIt('refuses an unknown harness and a malformed persona', async (scene) => {
    const unknown = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
      harnessId: scene.world.adapters.ids.next(),
      persona: 'agent:iterate',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    });
    const malformed = await grantAs(scene, scene.kim, 'human:someone');
    expect([reasonOf(unknown), reasonOf(malformed)]).toEqual([
      'harness_not_found',
      'malformed_command',
    ]);
  });
});

describe('KN-16 a delegation has a required expiry', () => {
  sceneIt('refuses an expiry at or before now', async (scene) => {
    const past = await grantAs(
      scene,
      scene.kim,
      'agent:iterate',
      new Date(nowOf(scene).getTime() - 1),
    );
    const now = await grantAs(scene, scene.kim, 'agent:iterate', nowOf(scene));
    expect([reasonOf(past), reasonOf(now)]).toEqual(['expiry_in_past', 'expiry_in_past']);
  });

  sceneIt('defaults the expiry to ninety days and records the grant', async (scene) => {
    const started = nowOf(scene);
    const delegation = value(await grantAs(scene, scene.kim));
    expect(delegation.expiresAt).toEqual(new Date(started.getTime() + 90 * day));
    expect(delegation.personId).toBe(scene.kim.personId);
    const [event] = await logOf(scene, 'delegation_granted');
    expect(event?.evidence).toMatchObject({ delegationId: delegation.id, supersedes: null });
  });
});

describe('KN-16 who may revoke a delegation', () => {
  sceneIt(
    'lets the delegating person or another area admin revoke, and an editor not',
    async (scene) => {
      const first = value(await grantAs(scene, scene.kim));
      const second = value(await grantAs(scene, scene.kim));
      const refusedEditor = await scene.world.kernel.delegations.revoke(
        simCaller(scene.world, scene.max),
        { delegationId: first.id },
      );
      const byLee = value(
        await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.lee), {
          delegationId: first.id,
        }),
      );
      const byKim = value(
        await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
          delegationId: second.id,
        }),
      );
      expect(reasonOf(refusedEditor)).toBe('not_permitted');
      expect([byLee.revokedAt, byKim.revokedAt]).toEqual([nowOf(scene), nowOf(scene)]);
      expect(await logOf(scene, 'delegation_revoked')).toHaveLength(2);
    },
  );

  sceneIt(
    'revokes once: a second revoke changes nothing and records nothing more',
    async (scene) => {
      const delegation = value(await grantAs(scene, scene.kim));
      const revoke = () =>
        scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
          delegationId: delegation.id,
        });
      value(await revoke());
      value(await revoke());
      expect(await logOf(scene, 'delegation_revoked')).toHaveLength(1);
      const unknown = await scene.world.kernel.delegations.revoke(
        simCaller(scene.world, scene.kim),
        {
          delegationId: scene.world.adapters.ids.next(),
        },
      );
      expect(reasonOf(unknown)).toBe('delegation_not_found');
    },
  );
});

describe('KN-16 renewal supersedes the old delegation', () => {
  sceneIt('revokes the old row and names it on the new one', async (scene) => {
    const old = value(await grantAs(scene, scene.kim));
    const renewal = value(
      await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
        harnessId: scene.harnessId,
        persona: 'agent:iterate',
        capability: 'build',
        expiresAt: null,
        supersedes: old.id,
      }),
    );
    expect(renewal.supersedes).toBe(old.id);
    expect((await rowOf(scene, old.id))?.revokedAt).toEqual(nowOf(scene));
    expect((await logOf(scene, 'delegation_revoked')).length).toBe(1);
    expect((await logOf(scene, 'delegation_granted')).length).toBe(2);
  });

  sceneIt('refuses an unknown row, and one of another person or persona', async (scene) => {
    const theirs = value(await grantAs(scene, scene.lee));
    const mine = value(await grantAs(scene, scene.kim));
    const supersede = (supersedes: string, persona: string) =>
      scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
        harnessId: scene.harnessId,
        persona,
        capability: 'iterate',
        expiresAt: null,
        supersedes,
      });
    const unknown = await supersede(scene.world.adapters.ids.next(), 'agent:iterate');
    const person = await supersede(theirs.id, 'agent:iterate');
    const persona = await supersede(mine.id, 'agent:builder');
    expect([reasonOf(unknown), reasonOf(person), reasonOf(persona)]).toEqual([
      'delegation_not_found',
      'not_permitted',
      'not_permitted',
    ]);
    expect((await rowOf(scene, mine.id))?.revokedAt).toBeNull();
  });
});

describe('KN-16 a beat checks the delegation and lapses it once', () => {
  sceneIt(
    'lapses an expired delegation once, even when a second agent of the person beats again',
    async (scene) => {
      const delegation = value(
        await grantAs(scene, scene.kim, 'agent:iterate', new Date(nowOf(scene).getTime() + hour)),
      );
      const beat = (second = false) =>
        scene.world.kernel.delegations.beat(
          agentOf(
            scene,
            scene.kim,
            second
              ? `${scene.kim.personId}/laptop as iterate via delegation:${delegation.id}`
              : 'iterate',
          ),
          { delegationId: delegation.id },
        );
      expect(reasonOf(await beat())).toBeNull();
      scene.world.adapters.clock.advance(2 * hour);
      const first = await beat();
      const second = await beat(true);
      expect([reasonOf(first), lapseWhy(first)]).toEqual(['delegation_lapsed', 'expired']);
      expect([reasonOf(second), lapseWhy(second)]).toEqual(['delegation_lapsed', 'expired']);
      expect(await logOf(scene, 'delegation_lapsed')).toHaveLength(1);
    },
  );
});

describe('KN-16 a beat binds the delegation to its person and capability', () => {
  sceneIt('lapses a revoked delegation as revoked', async (scene) => {
    const delegation = value(await grantAs(scene, scene.kim));
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
      delegationId: delegation.id,
    });
    const beat = await scene.world.kernel.delegations.beat(agentOf(scene, scene.kim), {
      delegationId: delegation.id,
    });
    expect([reasonOf(beat), lapseWhy(beat)]).toEqual(['delegation_lapsed', 'revoked']);
    expect(await logOf(scene, 'delegation_lapsed')).toHaveLength(1);
  });

  sceneIt('opens nothing under the capability none', async (scene) => {
    const delegation = value(
      await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
        harnessId: scene.harnessId,
        persona: 'agent:iterate',
        capability: 'none',
        expiresAt: null,
        supersedes: null,
      }),
    );
    const beat = value(
      await scene.world.kernel.delegations.beat(agentOf(scene, scene.kim), {
        delegationId: delegation.id,
      }),
    );
    expect(beat.principal.grants).toEqual([]);
    expect(beat.principal.kind).toBe('agent');
  });

  sceneIt('is usable only by its own person and persona (R20)', async (scene) => {
    const delegation = value(await grantAs(scene, scene.kim));
    const beat = (caller: Caller) =>
      scene.world.kernel.delegations.beat(caller, { delegationId: delegation.id });
    const otherPerson = await beat(agentOf(scene, scene.lee));
    const otherPersona = await beat(agentOf(scene, scene.kim, 'builder'));
    const human = await beat(simCaller(scene.world, scene.kim));
    const unknown = await scene.world.kernel.delegations.beat(agentOf(scene, scene.kim), {
      delegationId: scene.world.adapters.ids.next(),
    });
    expect([otherPersona, human].map(reasonOf)).toEqual(['not_permitted', 'not_permitted']);
    expect(otherPerson).toEqual({
      status: 'error',
      reason: 'delegation_not_found',
      detail: { delegationId: delegation.id },
    });
    expect(reasonOf(unknown)).toBe('delegation_not_found');
    expect(await logOf(scene, 'delegation_lapsed')).toEqual([]);
  });
});

describe('KN-16 live delegations are queryable', () => {
  sceneIt(
    'filters by person, by persona and by harness; all-null lists every live one',
    async (scene) => {
      const iterate = value(await grantAs(scene, scene.kim));
      const builder = value(await grantAs(scene, scene.lee, 'agent:builder'));
      const revoked = value(await grantAs(scene, scene.kim, 'agent:other'));
      await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
        delegationId: revoked.id,
      });
      const live = async (filter: { personId?: string; persona?: string; harnessId?: string }) =>
        value(
          await scene.world.kernel.delegations.live(simCaller(scene.world, scene.kim), {
            personId: filter.personId ?? null,
            persona: filter.persona ?? null,
            harnessId: filter.harnessId ?? null,
          }),
        ).map((delegation) => delegation.id);
      expect(await live({ personId: scene.kim.personId ?? '' })).toEqual([iterate.id]);
      expect(await live({ persona: 'agent:builder' })).toEqual([builder.id]);
      expect(await live({ harnessId: scene.harnessId })).toEqual([iterate.id, builder.id]);
      expect(await live({ harnessId: scene.world.adapters.ids.next() })).toEqual([]);
      expect(await live({})).toEqual([iterate.id, builder.id]);
    },
  );
});

describe('KN-16 renewal races and dead rows', () => {
  sceneIt('refuses a second renewal of a row another renewal already revoked', async (scene) => {
    const old = value(await grantAs(scene, scene.kim));
    const renew = () =>
      scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
        harnessId: scene.harnessId,
        persona: 'agent:iterate',
        capability: 'iterate',
        expiresAt: null,
        supersedes: old.id,
      });
    value(await renew());
    expect(reasonOf(await renew())).toBe('stale_version');
    expect(await logOf(scene, 'delegation_granted')).toHaveLength(2);
    expect(await logOf(scene, 'delegation_revoked')).toHaveLength(1);
  });

  sceneIt(
    'renews an expired or lapsed row without stamping or recording a revoke',
    async (scene) => {
      const expiring = value(
        await grantAs(scene, scene.kim, 'agent:iterate', new Date(nowOf(scene).getTime() + hour)),
      );
      scene.world.adapters.clock.advance(2 * hour);
      const renewal = value(
        await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.kim), {
          harnessId: scene.harnessId,
          persona: 'agent:iterate',
          capability: 'iterate',
          expiresAt: null,
          supersedes: expiring.id,
        }),
      );
      expect(renewal.supersedes).toBe(expiring.id);
      expect((await rowOf(scene, expiring.id))?.revokedAt).toBeNull();
      expect(await logOf(scene, 'delegation_revoked')).toEqual([]);
    },
  );
});

describe('KN-16 a lapse is final and live respects read access', () => {
  sceneIt('stays lapsed when the admin grant comes back, with no second event', async (scene) => {
    const delegation = value(await grantAs(scene, scene.kim));
    const adminGrant = scene.kim.grants[0];
    if (adminGrant === undefined) throw new Error('kim has no grant');
    await revokeSeededGrant(scene.world.database.db, adminGrant.grantId, nowOf(scene));
    const beat = () =>
      scene.world.kernel.delegations.beat(agentOf(scene, scene.kim), {
        delegationId: delegation.id,
      });
    expect(lapseWhy(await beat())).toBe('grant_lost');
    await seedGrant(scene.world.database.db, {
      id: '00000000-0000-4000-8000-0000000d0f01',
      personId: scene.kim.personId ?? '',
      role: 'admin',
      scopeKind: 'jd_area',
      scopeArea: '80-89',
      grantedAt: nowOf(scene),
      expiresAt: null,
    });
    const again = await beat();
    expect([reasonOf(again), lapseWhy(again)]).toEqual(['delegation_lapsed', 'grant_lost']);
    expect(await logOf(scene, 'delegation_lapsed')).toHaveLength(1);
  });

  sceneIt('lists nothing to a caller who cannot read the harness', async (scene) => {
    value(await grantAs(scene, scene.kim));
    const nobody = await simPerson(scene.world, 7, []);
    const none = await scene.world.kernel.delegations.live(simCaller(scene.world, nobody), {
      personId: null,
      persona: null,
      harnessId: null,
    });
    expect(value(none)).toEqual([]);
  });
});
