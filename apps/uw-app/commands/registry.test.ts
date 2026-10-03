import { describe, expect, it } from 'vitest';
import { commandNames } from '@uw/contracts';
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
