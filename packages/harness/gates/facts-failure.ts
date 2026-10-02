import { refused, type Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';

export function factsFailure(error: unknown): Refused {
  if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
  const name = error instanceof Error ? error.name : 'unknown';
  return refused('internal_error', { port: 'githubFacts', error: name });
}
