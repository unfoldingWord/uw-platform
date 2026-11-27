import type { AssistantTurnBinding, AssistantTurnStart } from '../../env.ts';

type TurnStarted = 'started' | 'already_started' | 'not_wired';
export type TurnStarter = (start: AssistantTurnStart) => Promise<TurnStarted>;

const ALREADY_EXISTS = /already[\s._-]?exists/i;

function alreadyExists(error: unknown): boolean {
  return error instanceof Error && ALREADY_EXISTS.test(error.message);
}

export function turnStarterOf(binding: AssistantTurnBinding | undefined): TurnStarter {
  return async (start) => {
    if (binding === undefined) return 'not_wired';
    try {
      await binding.create({ id: start.requestId, params: start });
      return 'started';
    } catch (error) {
      if (alreadyExists(error)) return 'already_started';
      throw error;
    }
  };
}
