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
