import { describe, expect, it } from 'vitest';
import { createLogger, errorFields } from './log.ts';

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, sink: (line: string) => lines.push(JSON.parse(line)) };
}

const context = {
  traceId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  commit: 'abc1234',
  route: 'GET /health',
  principal: null,
};

describe('FD-11 the structured logger', () => {
  it('writes every required field on every line, in order', () => {
    const { lines, sink } = capture();
    createLogger(context, sink).info('request', { outcome: 'http_200', latencyMs: 12 });
    expect(Object.keys(lines[0] ?? {})).toEqual([
      'level',
      'message',
      'trace_id',
      'principal',
      'route',
      'latency_ms',
      'outcome',
      'commit',
    ]);
    expect(lines[0]).toMatchObject({
      level: 'info',
      trace_id: context.traceId,
      latency_ms: 12,
      outcome: 'http_200',
      commit: 'abc1234',
    });
  });

  it('writes null latency when none is given and keeps extra primitive fields', () => {
    const { lines, sink } = capture();
    createLogger(context, sink).warn('webhook refused', { outcome: 'unsigned', source: 'github' });
    expect(lines[0]).toMatchObject({ latency_ms: null, source: 'github', level: 'warn' });
  });

  it('carries a principal set later, and never lets an extra field overwrite a required one', () => {
    const { lines, sink } = capture();
    createLogger(context, sink)
      .with({ principal: 'human:ian' })
      .error('failed', { outcome: 'internal_error', trace_id: 'forged' });
    expect(lines[0]).toMatchObject({ principal: 'human:ian', trace_id: context.traceId });
  });
});

describe('FD-11 error fields for a log line', () => {
  it('names the error and carries its message', () => {
    expect(errorFields(new TypeError('no such column'))).toEqual({
      error_name: 'TypeError',
      error_message: 'no such column',
    });
  });

  it('bounds the message to 200 characters', () => {
    expect(errorFields(new Error('x'.repeat(500)))).toEqual({
      error_name: 'Error',
      error_message: 'x'.repeat(200),
    });
  });

  it('describes a thrown value that is not an Error', () => {
    expect(errorFields('plain string')).toEqual({
      error_name: 'non_error',
      error_message: 'plain string',
    });
  });
});

describe('FD-11 error fields never carry a URL', () => {
  it('replaces every URL in the message, credentials and all', () => {
    const error = new Error('connect postgres://u:pw@db.example/x failed; see https://a.b/c?t=1');
    expect(errorFields(error)).toMatchObject({ error_message: 'connect <url> failed; see <url>' });
  });
});

function drizzleQueryError(cause: object): Error {
  return new Error(
    'Failed query: update "people" set "status" = $1 where "email" = $2\nparams: active,ada.lovelace@example.org',
    { cause },
  );
}

describe('FD-11 error fields for a database error', () => {
  const postgresCause = {
    name: 'PostgresError',
    code: '23505',
    constraint_name: 'people_email_key',
    table_name: 'people',
    message: 'duplicate key value violates unique constraint "people_email_key"',
  };

  it('names the cause, its code, constraint and table, and nothing else', () => {
    expect(errorFields(drizzleQueryError(postgresCause))).toEqual({
      error_name: 'PostgresError',
      error_code: '23505',
      constraint_name: 'people_email_key',
      table_name: 'people',
    });
  });

  it('never lets a query parameter reach the serialised line', () => {
    const { lines, sink } = capture();
    const fields = errorFields(drizzleQueryError(postgresCause));
    createLogger(context, sink).error('request failed', { outcome: 'internal_error', ...fields });
    expect(JSON.stringify(lines)).not.toContain('example.org');
    expect(JSON.stringify(lines)).not.toContain('Failed query');
  });

  it('reads the constraint field PGlite uses', () => {
    const fields = errorFields(
      drizzleQueryError({ name: 'error', code: '23503', constraint: 'fk' }),
    );
    expect(fields).toEqual({ error_name: 'error', error_code: '23503', constraint_name: 'fk' });
  });
});

describe('FD-11 error fields find a database error wherever it sits', () => {
  it('reads a code carried by the error itself', () => {
    const direct = Object.assign(new Error('secret row value'), { code: '40001' });
    expect(errorFields(direct)).toEqual({ error_name: 'Error', error_code: '40001' });
  });

  it('finds a code several causes down, within a small depth', () => {
    const deep = new Error('outer', { cause: new Error('middle', { cause: { code: '57014' } }) });
    expect(errorFields(deep)).toMatchObject({ error_code: '57014' });
  });

  it('keeps the redacted bounded message when no cause carries a code', () => {
    const error = new Error('connect https://a.b/c failed', { cause: new Error('refused') });
    expect(errorFields(error)).toEqual({
      error_name: 'Error',
      error_message: 'connect <url> failed',
    });
  });

  it('does not take a non-SQLSTATE code such as ECONNREFUSED for a database error', () => {
    const error = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    expect(errorFields(error)).toEqual({
      error_name: 'Error',
      error_message: 'connect failed',
    });
  });
});

describe('FD-11 error fields for a query that failed without a SQLSTATE', () => {
  const sql = 'update "people" set "bio" = $1 where "email" = $2';
  const params = 'private bio text,ada.lovelace@example.org';

  function failedQuery(cause?: object): Error {
    return Object.assign(new Error(`Failed query: ${sql}\nparams: ${params}`), {
      query: sql,
      params: [params],
      ...(cause === undefined ? {} : { cause }),
    });
  }

  it('logs only the name when there is no cause', () => {
    expect(errorFields(failedQuery())).toEqual({ error_name: 'Error' });
  });

  it('logs the cause name and a non-SQLSTATE code, never the query', () => {
    const fields = errorFields(failedQuery({ name: 'Error', code: 'ECONNRESET' }));
    expect(fields).toEqual({ error_name: 'Error', error_code: 'ECONNRESET' });
  });

  it('recognises a quoted query by its message alone', () => {
    const fields = errorFields(new Error(`Failed query: ${sql}`, { cause: { name: 'X' } }));
    expect(fields).toEqual({ error_name: 'X' });
  });

  it('does not take a Node code such as EPIPE for a SQLSTATE', () => {
    const error = Object.assign(new Error('write failed'), { code: 'EPIPE' });
    expect(errorFields(error)).toEqual({ error_name: 'Error', error_message: 'write failed' });
  });

  it('caps a constraint name at 200 characters', () => {
    const cause = { code: '23505', constraint_name: 'c'.repeat(500) };
    expect(errorFields(new Error('x', { cause }))).toMatchObject({
      constraint_name: 'c'.repeat(200),
    });
  });
});

describe('FD-11 which codes count as a SQLSTATE', () => {
  it.each(['23505', 'P0001', 'XX000', 'F0000', 'HV000'])('counts %s', (code) => {
    const error = new Error('row value', { cause: { code } });
    expect(errorFields(error)).toEqual({ error_name: 'Error', error_code: code });
  });

  it.each(['EPIPE', 'ECONNRESET', 'CONNECT_TIMEOUT'])('does not count %s', (code) => {
    expect(errorFields(Object.assign(new Error('m'), { code }))).toHaveProperty('error_message');
  });
});
