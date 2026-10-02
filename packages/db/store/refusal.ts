import { databaseErrorFacts } from '@uw/core/database-error';

export class StoreRefusedError extends Error {
  readonly code: string;
  readonly constraint: string | null;
  readonly table: string | null;

  constructor(code: string, constraint: string | null, table: string | null, cause: unknown) {
    super(
      `the database refused the write (${code}${constraint === null ? '' : ` ${constraint}`})`,
      {
        cause,
      },
    );
    this.name = 'StoreRefusedError';
    this.code = code;
    this.constraint = constraint;
    this.table = table;
  }
}

const triggerRefusal = 'P0001';

function refuses(code: string | null): code is string {
  return code !== null && (code.startsWith('23') || code === triggerRefusal);
}

export async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const facts = databaseErrorFacts(error);
    if (facts !== null && refuses(facts.code)) {
      throw new StoreRefusedError(facts.code, facts.constraint, facts.table, error);
    }
    throw error;
  }
}
