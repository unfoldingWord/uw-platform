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

  it('rejects a wake the hub refuses, and logs nothing for one it takes', async () => {
    const { logger, lines } = recordingLogger();
    const refusing = namespaceAnswering(async () => new Response(null, { status: 400 }));
    const taking = namespaceAnswering(async () => new Response(null, { status: 202 }));
    await expect(platformHub(refusing, logger, never).wake(harnessId)).rejects.toThrow('400');
    await expect(platformHub(taking, logger, never).wake(harnessId)).resolves.toBeUndefined();
    expect(lines).toEqual([]);
  });
});
