import { describe, expect, it } from 'vitest';
import {
  notWiredCall,
  PortNotWiredError,
  ProviderMismatchError,
  RunTransitionError,
  ToolOutsideToolsetError,
} from './index.ts';

describe('DX-1 port errors', () => {
  it('notWiredCall rejects with PortNotWiredError naming the port and method', async () => {
    const rejection = notWiredCall('hub', 'wake');
    await expect(rejection).rejects.toBeInstanceOf(PortNotWiredError);
    await expect(rejection).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'hub',
      method: 'wake',
      message: 'hub.wake is not wired',
    });
  });

  it('RunTransitionError names the action, the run and the state it was in', () => {
    expect(new RunTransitionError('r1', 'stopped', 'resume').message).toBe(
      'cannot resume run r1 from stopped',
    );
  });

  it('RunTransitionError names nothing as the state when the run does not exist', () => {
    expect(new RunTransitionError('r1', null, 'hibernate').message).toBe(
      'cannot hibernate run r1 from nothing',
    );
  });

  it('ToolOutsideToolsetError names the verb', () => {
    const error = new ToolOutsideToolsetError('write_page');
    expect(error.verb).toBe('write_page');
    expect(error.message).toBe('the turn called write_page, which is outside the offered toolset');
  });

  it('ProviderMismatchError names the pinned and the resolved provider', () => {
    const error = new ProviderMismatchError('anthropic', 'together');
    expect(error).toMatchObject({
      name: 'ProviderMismatchError',
      pinned: 'anthropic',
      resolved: 'together',
    });
    expect(error.message).toBe(
      'the run pins provider anthropic, but the turn was served by together',
    );
  });

  it('ProviderMismatchError says so when no provider served the turn', () => {
    expect(new ProviderMismatchError('anthropic', null).message).toBe(
      'the run pins provider anthropic, but the turn was served by no provider',
    );
  });
});

describe('DX-1 run transitions out of the terminal states', () => {
  it.each(['completed', 'failed'] as const)('names %s as the state', (state) => {
    expect(new RunTransitionError('r1', state, 'resume').message).toBe(
      `cannot resume run r1 from ${state}`,
    );
  });
});
