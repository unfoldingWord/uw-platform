export type LogLevel = 'info' | 'warn' | 'error';

export type LogContext = {
  readonly traceId: string;
  readonly commit: string;
  readonly route: string;
  readonly principal: string | null;
};

export type LogValue = string | number | boolean | null;

export type LogFields = { readonly outcome: string; readonly latencyMs?: number } & {
  readonly [key: string]: LogValue | undefined;
};

export type LogSink = (line: string) => void;

export type Logger = {
  readonly context: LogContext;
  with(update: Partial<LogContext>): Logger;
  info(message: string, fields: LogFields): void;
  warn(message: string, fields: LogFields): void;
  error(message: string, fields: LogFields): void;
};

const required = new Set([
  'level',
  'message',
  'trace_id',
  'principal',
  'route',
  'latency_ms',
  'outcome',
  'commit',
]);

function render(level: LogLevel, message: string, context: LogContext, fields: LogFields): string {
  const { outcome, latencyMs, ...extra } = fields;
  const kept = Object.entries(extra).filter(
    ([key, value]) => value !== undefined && !required.has(key),
  );
  return JSON.stringify({
    level,
    message,
    trace_id: context.traceId,
    principal: context.principal,
    route: context.route,
    latency_ms: latencyMs ?? null,
    outcome,
    commit: context.commit,
    ...Object.fromEntries(kept),
  });
}

export function createLogger(context: LogContext, sink: LogSink): Logger {
  const write = (level: LogLevel) => (message: string, fields: LogFields) => {
    sink(render(level, message, context, fields));
  };
  return {
    context,
    with: (update) => createLogger({ ...context, ...update }, sink),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
}

const ERROR_MESSAGE_LIMIT = 200;
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

const CAUSE_DEPTH_LIMIT = 4;
const SQLSTATE = /^[0-9A-DF-Z][0-9A-Z]{4}$/;
const FAILED_QUERY_PREFIX = 'Failed query:';
const DATABASE_FIELD_LIMIT = 200;

export type DatabaseErrorFields = {
  readonly error_name: string;
  readonly error_code?: string;
  readonly constraint_name?: string;
  readonly table_name?: string;
};

export type MessageErrorFields = { readonly error_name: string; readonly error_message: string };

export type ErrorFields = DatabaseErrorFields | MessageErrorFields;

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

function optionalField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function databaseFields(chain: readonly unknown[]): DatabaseErrorFields | null {
  const state = chain.map(sqlState).find((code) => code !== undefined);
  const marked = chain.some(quotesQuery);
  if (state === undefined && !marked) return null;
  const named = chain.map((link) => textField(link, 'name')).filter((name) => name !== undefined);
  const code = state ?? chain.map((link) => textField(link, 'code')).find((c) => c !== undefined);
  const constraint = chain
    .map((link) => textField(link, 'constraint_name') ?? textField(link, 'constraint'))
    .find((name) => name !== undefined);
  const table = chain
    .map((link) => textField(link, 'table_name'))
    .find((name) => name !== undefined);
  return {
    error_name: named.at(-1) ?? 'database_error',
    ...optionalField('error_code', code),
    ...optionalField('constraint_name', constraint),
    ...optionalField('table_name', table),
  };
}

export function errorFields(error: unknown): ErrorFields {
  const database = databaseFields(errorChain(error));
  if (database !== null) return database;
  const isError = error instanceof Error;
  const message = isError ? error.message : String(error);
  return {
    error_name: isError ? error.name : 'non_error',
    error_message: message.replace(URL_IN_TEXT, '<url>').slice(0, ERROR_MESSAGE_LIMIT),
  };
}
