import { z } from 'zod';
import { errorReasonSchema, eventPageReplySchema, type EventPageReply } from '@uw/contracts';

const OK = 200;
const refusalBody = z.object({ status: z.literal('error'), reason: errorReasonSchema });

export class EventReadRefused extends Error {
  readonly reason: string | null;

  constructor(reason: string | null) {
    super(`event read refused: ${reason ?? 'unknown'}`);
    this.name = 'EventReadRefused';
    this.reason = reason;
  }
}

async function reasonOf(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  const refusal = refusalBody.safeParse(body);
  return refusal.success ? refusal.data.reason : null;
}

export function readEvents(
  fetcher: typeof fetch,
  harnessId: string,
  itemId: string | null = null,
): (after: number) => Promise<EventPageReply> {
  const item = itemId === null ? '' : `&item=${encodeURIComponent(itemId)}`;
  return async (after) => {
    const response = await fetcher(`/api/harness/${harnessId}/events?after=${after}${item}`, {
      headers: { accept: 'application/json' },
    });
    if (response.status !== OK) throw new EventReadRefused(await reasonOf(response));
    return eventPageReplySchema.parse(await response.json());
  };
}
