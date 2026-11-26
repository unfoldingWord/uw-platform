import type { AssistantEffectFailure } from '@uw/contracts';
import type { DirectMessage, DirectMessages } from '../ports.ts';

export type Delivered = 'sent' | AssistantEffectFailure;

function failureOf(error: unknown): AssistantEffectFailure {
  return error instanceof Error && error.name === 'PortNotWiredError'
    ? 'not_wired'
    : 'outcome_unknown';
}

export async function deliver(port: DirectMessages, message: DirectMessage): Promise<Delivered> {
  try {
    const delivery = await port.send(message);
    return delivery.outcome;
  } catch (error) {
    return failureOf(error);
  }
}
