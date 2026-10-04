import { describe, expect, it } from 'vitest';
import { inPersonOrder } from './after-commit.ts';

type Planned = {
  readonly name: string;
  readonly wake: { readonly recipients: readonly { readonly personId: string }[] };
};

function planned(name: string, ...people: string[]): Planned {
  return { name, wake: { recipients: people.map((personId) => ({ personId })) } };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('sending the wakes of one commit', () => {
  it('sends a person their wakes one after another in rank order, and other people at once', async () => {
    const started: string[] = [];
    const strongest = deferred();
    const send = async ({ name }: Planned): Promise<void> => {
      started.push(name);
      if (name === 'gate') await strongest.promise;
    };
    const sending = inPersonOrder(
      [
        planned('gate', 'p1', 'p2'),
        planned('failed', 'p1'),
        planned('other', 'p3'),
        planned('posted'),
      ],
      send,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['gate', 'other', 'posted']);
    strongest.resolve();
    await sending;
    expect(started).toEqual(['gate', 'other', 'posted', 'failed']);
  });

  it('sends the next wake for a person when the one before it failed', async () => {
    const started: string[] = [];
    const send = async ({ name }: Planned): Promise<void> => {
      started.push(name);
      if (name === 'gate') throw new Error('push service down');
    };
    await inPersonOrder([planned('gate', 'p1'), planned('advanced', 'p1')], send);
    expect(started).toEqual(['gate', 'advanced']);
  });
});
