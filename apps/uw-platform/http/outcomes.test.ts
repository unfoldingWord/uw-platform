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
  ['export_limit_reached', 429],
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

const measureReasons: readonly (readonly [ErrorReason, number])[] = [
  ['trial_required', 409],
  ['trial_unreadable', 409],
  ['measure_paused', 409],
  ['run_too_soon', 429],
];

describe('ADR 0036 a measure command refusal answers with the status its reason names', () => {
  it.each(measureReasons)('%s answers %i with the reason in the body', async (reason, status) => {
    const response = await refuser(reason).request('/');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ status: 'error', reason });
  });
});

const storyReasons: readonly (readonly [ErrorReason, number])[] = [
  ['story_above_channel', 403],
  ['consent_required', 409],
  ['consent_expired', 409],
  ['consent_withdrawn', 409],
  ['photo_release_required', 409],
];

describe('#201 a story refusal answers with the status its reason names', () => {
  it.each(storyReasons)(
    '#201 %s answers %i with the reason in the body',
    async (reason, status) => {
      const response = await refuser(reason).request('/');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ status: 'error', reason });
    },
  );
});
