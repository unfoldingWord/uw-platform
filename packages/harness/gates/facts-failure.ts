import { refused, type Refused } from '../outcome.ts';
import { FactsUnavailableError, PortNotWiredError } from '../port-errors.ts';
import { staleRefusal } from './facts-fresh.ts';

export function factsFailure(error: unknown): Refused {
  if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
  if (error instanceof FactsUnavailableError) return staleRefusal(null);
  const name = error instanceof Error ? error.name : 'unknown';
  return refused('internal_error', { port: 'githubFacts', error: name });
}
