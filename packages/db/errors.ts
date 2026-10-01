import { databaseErrorFacts } from '@uw/core/database-error';

export function pgErrorCode(error: unknown): string | null {
  return databaseErrorFacts(error)?.code ?? null;
}

export function pgConstraint(error: unknown): string | null {
  return databaseErrorFacts(error)?.constraint ?? null;
}
