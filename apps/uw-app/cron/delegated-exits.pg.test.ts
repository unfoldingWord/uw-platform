import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { ian } from '../testing/commands.ts';
import { exitDelegatedMerges } from './delegated-exits.ts';

type Line = Record<string, unknown>;

function loggerInto(lines: Line[]) {
  const context = { traceId: randomUUID(), commit: 'test', route: 'cron minute', principal: null };
  return createLogger(context, (line: string) => lines.push(JSON.parse(line) as Line));
}

describe.skipIf(!testServer)('MD-3 the minute job runs the delegated exits as the system', () => {
  it('MD-3 runs exitDelegated as the system and logs what it exited', () =>
    withAppDatabase(async (db) => {
      const lines: Line[] = [];
      const kernel = kernelOn(db, { now: () => new Date() });
      const caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
      await exitDelegatedMerges(kernel, { caller, logger: loggerInto(lines) });
      expect(lines.at(-1)).toMatchObject({
        step: 'delegated_exits',
        outcome: 'delegated_exits_run',
        exited: 0,
        merged: 0,
      });
    }));

  it('MD-3 logs each delegated exit that threw, and still logs the run', async () => {
    const lines: Line[] = [];
    const failed = [{ itemId: randomUUID(), decisionId: randomUUID(), error: 'boom' }];
    const kernel = {
      gates: {
        exitDelegated: () =>
          Promise.resolve({ status: 'accepted' as const, value: { exited: [], failed } }),
      },
    };
    const caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
    await exitDelegatedMerges(kernel, { caller, logger: loggerInto(lines) });
    expect(lines).toMatchObject([
      { level: 'error', outcome: 'internal_error', itemId: failed[0]?.itemId, detail: 'boom' },
      { outcome: 'delegated_exits_run', exited: 0, merged: 0, failed: 1 },
    ]);
  });

  it('MD-3 logs a refusal for any other caller and exits nothing', () =>
    withAppDatabase(async (db) => {
      const lines: Line[] = [];
      const kernel = kernelOn(db, { now: () => new Date() });
      const caller = {
        actor: agentOf(await ian(db), 'shipper'),
        traceId: randomUUID(),
        requestId: null,
      };
      await exitDelegatedMerges(kernel, { caller, logger: loggerInto(lines) });
      expect(lines.at(-1)).toMatchObject({ step: 'delegated_exits', outcome: 'not_permitted' });
    }));
});
