import { describe, expect, it } from 'vitest';
import { platformGitHubTransport } from './transport.ts';

function asMethodOf(send: typeof fetch): Promise<unknown> {
  const holder = { send };
  return Promise.resolve().then(() => holder.send('not a url'));
}

describe('the platform GitHub transport binds fetch to the global scope', () => {
  it('shows the hazard: the Workers fetch called as a method of another object is refused', async () => {
    await expect(asMethodOf(globalThis.fetch)).rejects.toThrow(/Illegal invocation/);
  });

  it('survives being called as a method of the transport or of any other object', async () => {
    const transport = platformGitHubTransport(() => new Date(0));
    await expect(Promise.resolve().then(() => transport.fetch('not a url'))).rejects.not.toThrow(
      /Illegal invocation/,
    );
    await expect(asMethodOf(transport.fetch)).rejects.not.toThrow(/Illegal invocation/);
  });

  it('carries the clock it is given', () => {
    expect(platformGitHubTransport(() => new Date(5)).now()).toEqual(new Date(5));
  });
});
