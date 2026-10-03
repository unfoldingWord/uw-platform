import { describe, expect, it } from 'vitest';
import { EventReadRefused, readEvents } from './read-events.ts';

const harnessId = 'b4000000-0000-4000-8000-000000000001';

const event = {
  eventId: 'b4000000-0000-4000-8000-0000000000e1',
  harnessId,
  itemId: 'b4000000-0000-4000-8000-0000000000b1',
  name: 'gate_approved',
  position: 8,
  at: '2026-10-01T09:00:00.000Z',
  actor: 'human:b4000000-0000-4000-8000-000000000002',
  evidence: { decisionId: 'b4000000-0000-4000-8000-0000000000d1', stage: 'ship' },
  traceId: 'b4000000-0000-4000-8000-0000000000c1',
  requestId: null,
};

type Asked = { url: string; accept: string | null };

function fakeFetch(status: number, body: unknown, asked: Asked[]): typeof fetch {
  return async (input, init) => {
    asked.push({ url: String(input), accept: new Headers(init?.headers).get('accept') });
    return Response.json(body, { status });
  };
}

describe('WB-3 readEvents reads the one event route', () => {
  it('WB-3 readEvents asks the one read route with the cursor and parses the page', async () => {
    const asked: Asked[] = [];
    const read = readEvents(fakeFetch(200, { events: [event], next: null }, asked), harnessId);
    const page = await read(7);
    expect(asked).toEqual([
      { url: `/api/harness/${harnessId}/events?after=7`, accept: 'application/json' },
    ]);
    expect(page.events.map((each) => each.position)).toEqual([8]);
    expect(page.next).toBeNull();
    const invalid = readEvents(
      fakeFetch(200, { events: [{ position: 9 }], next: null }, []),
      harnessId,
    );
    await expect(invalid(7)).rejects.toThrow();
  });
});

describe('a refused event read', () => {
  it('rejects with the refusal reason the route answered', async () => {
    const body = { status: 'error', reason: 'harness_not_found' };
    const read = readEvents(fakeFetch(404, body, []), harnessId);
    const refused = await read(0).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(EventReadRefused);
    expect((refused as EventReadRefused).reason).toBe('harness_not_found');
  });

  it('rejects with no reason when the body is not a refusal', async () => {
    const read = readEvents(fakeFetch(502, { oops: true }, []), harnessId);
    const refused = await read(0).catch((error: unknown) => error);
    expect((refused as EventReadRefused).reason).toBeNull();
  });
});
