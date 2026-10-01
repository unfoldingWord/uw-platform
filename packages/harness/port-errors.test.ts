import { describe, expect, it } from 'vitest';
import {
  notWiredCall,
  PortNotWiredError,
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

  it('RunTransitionError says nothing when the run does not exist', () => {
    expect(new RunTransitionError('r1', null, 'hibernate').message).toBe(
      'cannot hibernate run r1 from nothing',
    );
  });

  it('ToolOutsideToolsetError names the verb', () => {
    const error = new ToolOutsideToolsetError('write_page');
    expect(error.verb).toBe('write_page');
    expect(error.message).toBe('the turn called write_page, which is outside the offered toolset');
  });
});
