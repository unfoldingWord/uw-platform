import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ErrorReason } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from './outcomes.ts';

const pdfReasons: readonly (readonly [ErrorReason, number])[] = [
  ['pdf_render_failed', 502],
  ['export_not_found', 404],
  ['export_not_ready', 409],
  ['binder_empty', 422],
  ['binder_too_large', 422],
];

function refuser(reason: ErrorReason): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get('/', (c) => refuse(c, reason));
  return app;
}

describe('#198 a PDF export refusal answers with the status its reason names', () => {
  it.each(pdfReasons)('#198 %s answers %i with the reason in the body', async (reason, status) => {
    const response = await refuser(reason).request('/');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: 'error', reason });
  });
});
