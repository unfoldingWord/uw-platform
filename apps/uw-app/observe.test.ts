import { describe, expect, it } from 'vitest';
import { createApp } from './app.tsx';
import { recordingDeps } from './testing/deps.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('FD-11 one trace id per request, and the request log line', () => {
  it('mints a trace id, returns it in x-trace-id and writes it on the log line', async () => {
    const { deps, lines } = recordingDeps();
    const response = await createApp(deps).request('/health', {}, { COMMIT_SHA: 'abc1234' });
    const traceId = response.headers.get('x-trace-id') ?? '';
    expect(traceId).toMatch(uuid);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      trace_id: traceId,
      principal: null,
      route: 'GET /health',
      outcome: 'http_200',
      commit: 'abc1234',
    });
    expect(typeof lines[0]?.['latency_ms']).toBe('number');
  });

  it('mints a fresh trace id even when the caller sends one', async () => {
    const { deps } = recordingDeps();
    const forged = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
    const response = await createApp(deps).request(
      '/health',
      { headers: { 'x-trace-id': forged } },
      {},
    );
    expect(response.headers.get('x-trace-id')).not.toBe(forged);
  });

  it('answers a failure with the closed-set refusal, no exception text, and logs the error', async () => {
    const { deps, lines } = recordingDeps();
    const failing = {
      ...deps,
      openDatabase: () => {
        throw new Error('connection string postgres://secret');
      },
    };
    const response = await createApp(failing).request('/health', {}, {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: 'error', reason: 'internal_error' });
    expect(lines.map((line) => line['level'])).toEqual(['error', 'info']);
    expect(lines[1]).toMatchObject({ outcome: 'internal_error' });
    expect(JSON.stringify(lines)).not.toContain('secret');
  });
});
