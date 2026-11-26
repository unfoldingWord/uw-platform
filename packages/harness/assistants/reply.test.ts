import { eventEvidenceSchemas } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { LoopResult } from '../runs/tool-loop.ts';
import { finishedDraft, NO_ANSWER, REFUSED_ANSWER, REPLY_LIMIT, replyTextOf } from './reply.ts';

const result: LoopResult = {
  outcome: 'ended',
  text: 'You have nothing booked.',
  usage: { inputTokens: 120, outputTokens: 12, costMicros: 20_000 },
  resolvedProvider: 'z-ai',
  resolvedModel: 'z-ai/glm-5.3-flash',
  toolsCalled: ['read_page', 'read_page', 'search_pages'],
  turns: 2,
};
const ids = {
  requestId: '00000000-0000-4000-8000-0000000000b1',
  turnId: '00000000-0000-4000-8000-0000000000c1',
};

describe('PA-2 the reply is the turn text, bounded, or a fixed sentence', () => {
  it('sends the loop text when the turn ended', () => {
    expect(replyTextOf(result)).toBe('You have nothing booked.');
  });

  it('caps a long reply', () => {
    expect(replyTextOf({ ...result, text: 'a'.repeat(REPLY_LIMIT + 5) })).toHaveLength(REPLY_LIMIT);
  });

  it('answers a fixed sentence for a refusal, a turn limit or an empty text', () => {
    expect(replyTextOf({ ...result, outcome: 'refused' })).toBe(REFUSED_ANSWER);
    expect(replyTextOf({ ...result, outcome: 'turn_limit', text: null })).toBe(NO_ANSWER);
    expect(replyTextOf({ ...result, text: '  ' })).toBe(NO_ANSWER);
  });
});

describe('PA-2 the finished turn records numbers and verbs, never text', () => {
  it('fits the strict evidence and carries no reply text', () => {
    const { evidence } = finishedDraft({ ...ids, result });
    expect(eventEvidenceSchemas.assistant_turn_finished.parse(evidence)).toEqual({
      ...ids,
      outcome: 'ended',
      turns: 2,
      inputTokens: 120,
      outputTokens: 12,
      costMicros: 20_000,
      tools: ['read_page', 'search_pages'],
    });
    expect(JSON.stringify(evidence)).not.toContain('booked');
  });

  it('records an unknown or malformed cost as null', () => {
    const unknown = { ...result, usage: { ...result.usage, costMicros: 1.5 } };
    expect(finishedDraft({ ...ids, result: unknown }).evidence['costMicros']).toBeNull();
  });
});
