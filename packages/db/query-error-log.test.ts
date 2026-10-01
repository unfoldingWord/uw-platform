import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { createLogger, errorFields } from '@uw/core/log';

const sql = 'update "people" set "bio" = $1 where "email" = $2';
const params = ['private bio text', 'ada.lovelace@example.org'];

function serialised(error: unknown): string {
  const lines: string[] = [];
  const context = { traceId: 't', commit: 'c', route: 'r', principal: null };
  createLogger(context, (line) => lines.push(line)).error('failed', {
    outcome: 'internal_error',
    ...errorFields(error),
  });
  return lines.join('\n');
}

function expectNoQueryData(line: string): void {
  expect(line).not.toContain('update "people"');
  expect(line).not.toContain('ada.lovelace');
  expect(line).not.toContain('private bio');
  expect(line).not.toContain('Failed query');
}

describe('FD-11 a real DrizzleQueryError never reaches a log line with its query', () => {
  it('holds with no cause', () => {
    expectNoQueryData(serialised(new DrizzleQueryError(sql, params, undefined)));
  });

  it('holds when the cause is a connection error with no SQLSTATE', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const line = serialised(new DrizzleQueryError(sql, params, cause));
    expectNoQueryData(line);
    expect(line).toContain('ECONNRESET');
  });
});
