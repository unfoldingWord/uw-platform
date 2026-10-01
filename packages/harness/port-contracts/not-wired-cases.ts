import { describe, expect, it } from 'vitest';
import type { PortName } from '../ports.ts';

function callWithoutArguments(target: object, method: string): Promise<unknown> {
  return new Promise((resolve) => {
    const member: unknown = Reflect.get(target, method);
    if (typeof member !== 'function') throw new TypeError(`${method} is not a method`);
    resolve(Reflect.apply(member, target, []));
  });
}

export function describeNotWired(
  port: PortName,
  adapter: string,
  target: object,
  methods: Readonly<Record<string, true>>,
): void {
  describe(`DX-3 ${port} port contract on ${adapter}, not wired`, () => {
    it.each(Object.keys(methods))('%s rejects with PortNotWiredError', async (method) => {
      await expect(callWithoutArguments(target, method)).rejects.toMatchObject({
        name: 'PortNotWiredError',
        port,
        method,
      });
    });
  });
}
