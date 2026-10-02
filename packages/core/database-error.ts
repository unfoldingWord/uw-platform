export type DatabaseErrorFacts = {
  readonly name: string;
  readonly code: string | null;
  readonly constraint: string | null;
  readonly table: string | null;
};

const CAUSE_DEPTH_LIMIT = 4;
const SQLSTATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;
const FAILED_QUERY_PREFIX = 'Failed query:';
const DATABASE_FIELD_LIMIT = 200;

function textField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return typeof found === 'string' ? found.slice(0, DATABASE_FIELD_LIMIT) : undefined;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (chain.length < CAUSE_DEPTH_LIMIT && typeof current === 'object' && current !== null) {
    chain.push(current);
    current = Reflect.get(current, 'cause');
  }
  return chain;
}

function quotesQuery(link: unknown): boolean {
  if (typeof link !== 'object' || link === null) return false;
  const hasQuery = typeof Reflect.get(link, 'query') === 'string' && Reflect.has(link, 'params');
  return hasQuery || (textField(link, 'message') ?? '').startsWith(FAILED_QUERY_PREFIX);
}

function sqlState(link: unknown): string | undefined {
  const code = textField(link, 'code');
  return code !== undefined && SQLSTATE.test(code) ? code : undefined;
}

function firstOf(
  chain: readonly unknown[],
  read: (link: unknown) => string | undefined,
): string | null {
  return chain.map(read).find((value) => value !== undefined) ?? null;
}

export function databaseErrorFacts(error: unknown): DatabaseErrorFacts | null {
  const chain = errorChain(error);
  const state = firstOf(chain, sqlState);
  if (state === null && !chain.some(quotesQuery)) return null;
  const named = chain.map((link) => textField(link, 'name')).filter((name) => name !== undefined);
  return {
    name: named.at(-1) ?? 'database_error',
    code: state ?? firstOf(chain, (link) => textField(link, 'code')),
    constraint: firstOf(
      chain,
      (link) => textField(link, 'constraint_name') ?? textField(link, 'constraint'),
    ),
    table: firstOf(chain, (link) => textField(link, 'table_name') ?? textField(link, 'table')),
  };
}
