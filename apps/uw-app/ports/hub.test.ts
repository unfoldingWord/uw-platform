import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import type { HubNamespace } from '../env.ts';
import type { Timers } from '../timers.ts';
import { hubNotWired } from './hub.not-wired.ts';
import { hubOf, platformHub } from './hub.ts';

const harnessId = 'b3000000-0000-4000-8000-000000000001';

function recordingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { traceId: 'trace', commit: 'test-commit', route: 'hub', principal: null },
    (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  return { logger, lines };
}

function namespaceAnswering(answer: () => Promise<Response>): HubNamespace {
  return { idFromName: (name) => name, get: () => ({ fetch: answer }) };
}

const expired: Timers = { after: async () => undefined };
const never: Timers = { after: () => new Promise<void>(() => undefined) };

describe('the platform hub adapter', () => {
  it('falls back to the not-wired hub when the Durable Object is not bound', () => {
    expect(hubOf({}, recordingLogger().logger)).toBe(hubNotWired);
  });

  it('resolves and logs a wake the hub does not answer in time', async () => {
    const { logger, lines } = recordingLogger();
    const hung = namespaceAnswering(() => new Promise<Response>(() => undefined));
    await expect(platformHub(hung, logger, expired).wake(harnessId)).resolves.toBeUndefined();
    expect(lines).toMatchObject([
      { level: 'warn', outcome: 'hub_wake_timed_out', harness_id: harnessId },
    ]);
  });

  it('logs and rejects a wake the hub refuses', async () => {
    const { logger, lines } = recordingLogger();
    const refusing = namespaceAnswering(async () => new Response(null, { status: 400 }));
    await expect(platformHub(refusing, logger, never).wake(harnessId)).rejects.toThrow('400');
    expect(lines).toMatchObject([
      { level: 'warn', outcome: 'hub_wake_refused', harness_id: harnessId, status: 400 },
    ]);
  });

  it('logs nothing for a wake the hub takes', async () => {
    const { logger, lines } = recordingLogger();
    const taking = namespaceAnswering(async () => new Response(null, { status: 202 }));
    await expect(platformHub(taking, logger, never).wake(harnessId)).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });
});

const query = {
  harnessId,
  personId: 'b3000000-0000-4000-8000-000000000003',
  screen: 'item' as const,
  itemId: 'b3000000-0000-4000-8000-000000000004',
};

function presenceOf(answer: () => Promise<Response>, timers: Timers = never) {
  const { logger, lines } = recordingLogger();
  const asked: string[] = [];
  const namespace: HubNamespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: (input) => {
        asked.push(String(input));
        return answer();
      },
    }),
  };
  return { hub: platformHub(namespace, logger, timers), lines, asked };
}

describe('the platform hub answers presence', () => {
  it("answers the hub's boolean for the person, screen and item", async () => {
    const { hub, lines, asked } = presenceOf(async () => Response.json({ present: true }));
    expect(await hub.present(query)).toBe(true);
    expect(asked).toEqual([
      `https://hub.internal/presence?person=${query.personId}&screen=item&item=${query.itemId}`,
    ]);
    expect(lines).toEqual([]);
    const gates = presenceOf(async () => Response.json({ present: false }));
    expect(await gates.hub.present({ ...query, screen: 'gates', itemId: null })).toBe(false);
    expect(gates.asked).toEqual([
      `https://hub.internal/presence?person=${query.personId}&screen=gates`,
    ]);
  });

  it.each([
    ['a timeout', () => new Promise<Response>(() => undefined), expired],
    ['a 500', async () => new Response(null, { status: 500 }), never],
    ['a malformed body', async () => Response.json({ present: 'yes', extra: 1 }), never],
  ] as const)(
    'answers false and logs hub_presence_unknown on %s',
    async (_label, answer, timers) => {
      const { hub, lines } = presenceOf(answer, timers);
      expect(await hub.present(query)).toBe(false);
      expect(lines).toMatchObject([
        { level: 'warn', outcome: 'hub_presence_unknown', harness_id: harnessId },
      ]);
    },
  );
});
