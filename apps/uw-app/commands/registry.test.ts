import { describe, expect, it } from 'vitest';
import { commandNames } from '@uw/contracts';
import { hubNotWired } from '../ports/hub.not-wired.ts';
import { notifierNotWired } from '../ports/notifier.not-wired.ts';
import { runsNotWired } from '../ports/runs.not-wired.ts';
import { executeCommand } from './dispatch.ts';
import { commandHandler, type CommandHandler } from './handler.ts';
import { notWiredCommand } from './not-wired.ts';
import { commandRegistry, commandRegistryOf } from './registry.ts';

const actions = {
  kickstart: 'write',
  enqueue: 'write',
  import: 'write',
  reorder: 'write',
  claim: 'write',
  release: 'write',
  submit_to_gate: 'write',
  approve: 'admin',
  reject: 'admin',
  take_over: 'admin',
  override: 'admin',
  prompt_run: 'write',
  stop_run: 'write',
  pause: 'admin',
  resume: 'admin',
  tweak_package: 'write',
  schedule_regular_tweak: 'admin',
  revoke_delegation: 'admin',
  recover_connectors: 'admin',
  activate_template: 'admin',
  create_stage: 'admin',
  update_stage: 'admin',
  reorder_stages: 'admin',
  remove_stage: 'admin',
  set_hosted_builder: 'admin',
} as const;

describe('WB-1 the command registry', () => {
  it('WB-1 serves every contract command with its pinned action', () => {
    expect([...commandRegistry.keys()].sort()).toEqual([...commandNames].sort());
    for (const name of commandNames) {
      expect(commandRegistry.get(name)?.action).toBe(actions[name]);
      expect(commandRegistry.get(name)?.name).toBe(name);
    }
  });

  it('refuses a handler that commandHandler or notWiredCommand did not build', () => {
    const built = commandHandler({
      name: 'claim',
      action: 'write',
      run: async () => ({ ok: true }),
    });
    const forged: CommandHandler = { ...built };
    expect(() => commandRegistryOf([forged])).toThrow(/claim/);
    expect(() => commandRegistryOf([built])).not.toThrow();
    expect(() => commandRegistryOf([notWiredCommand('claim', 'write')])).not.toThrow();
  });

  it('refuses two handlers for one command', () => {
    const one = notWiredCommand('claim', 'write');
    const two = notWiredCommand('claim', 'write');
    expect(() => commandRegistryOf([one, two])).toThrow(/claim/);
  });

  it('builds frozen handlers whose run re-parses the body against the command schema', async () => {
    const built = commandHandler({
      name: 'claim',
      action: 'write',
      run: async () => ({ ok: true }),
    });
    expect(Object.isFrozen(built)).toBe(true);
    expect(built).toMatchObject({ scope: 'harness', agents: 'refused' });
    await expect(built.run({} as never, { command: 'claim' })).rejects.toThrow();
  });

  it('answers not_wired from a command that is not wired', async () => {
    const body = {
      command: 'stop_run',
      requestId: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
    };
    expect(await notWiredCommand('stop_run', 'write').run({} as never, body)).toEqual({
      ok: false,
      reason: 'not_wired',
    });
  });
});

describe('the command builders guard the agent rule and the brand', () => {
  it('lets only the four gate decisions reach the kernel for an agent', () => {
    const run = async () => ({ ok: true }) as const;
    for (const name of ['approve', 'reject', 'take_over', 'override'] as const) {
      expect(() =>
        commandHandler({ name, action: 'admin', agents: 'recorded', run }),
      ).not.toThrow();
    }
    expect(() =>
      commandHandler({ name: 'claim', action: 'write', agents: 'recorded', run }),
    ).toThrow(/claim/);
    expect(() =>
      commandHandler({ name: 'recover_connectors', action: 'admin', agents: 'recorded', run }),
    ).toThrow(/recover_connectors/);
  });

  it('lets only revoke_delegation waive admin for the delegation owner', () => {
    const run = async () => ({ ok: true }) as const;
    expect(() =>
      commandHandler({ name: 'revoke_delegation', action: 'admin', ownerMayRevoke: true, run }),
    ).not.toThrow();
    expect(() =>
      commandHandler({ name: 'pause', action: 'admin', ownerMayRevoke: true, run }),
    ).toThrow(/pause/);
    const waiving = [...commandRegistry.values()].filter((handler) => handler.ownerMayRevoke);
    expect(waiving.map((handler) => handler.name)).toEqual(['revoke_delegation']);
  });

  it('refuses to dispatch to a handler no builder made, even from a hand-made registry', async () => {
    const built = notWiredCommand('claim', 'write');
    const registry = new Map([['claim' as const, { ...built }]]);
    const request = {
      name: 'claim',
      harness: crypto.randomUUID(),
      body: null,
      principal: null,
      traceId: crypto.randomUUID(),
      at: new Date(),
    };
    const scope = {
      database: null,
      registry,
      gateGitHub: () => null,
      hub: hubNotWired,
      runs: runsNotWired,
      notifier: notifierNotWired,
      logger: {} as never,
    };
    await expect(executeCommand(request, scope)).rejects.toThrow(/claim/);
  });
});
