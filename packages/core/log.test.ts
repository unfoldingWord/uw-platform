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
    const fields = errorFields(new Error('x'.repeat(500)));
    expect(fields.error_message).toHaveLength(200);
  });

  it('describes a thrown value that is not an Error', () => {
    expect(errorFields('plain string')).toEqual({
      error_name: 'non_error',
      error_message: 'plain string',
    });
  });
});
