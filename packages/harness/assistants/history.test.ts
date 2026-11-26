import { describe, expect, it } from 'vitest';
import type { AssistantEffectRow, AssistantRequestRow } from '../ports.ts';
import { HISTORY_PAIRS, historyOf, replyKeyOf } from './history.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const start = new Date('2026-10-01T09:00:00.000Z').getTime();
const hour = 60 * 60 * 1000;
const day = 24 * hour;

function request(n: number, at: number, threadKey: string | null = 'dm'): AssistantRequestRow {
  return {
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
    harnessId,
    personId: '00000000-0000-4000-8000-000000000105',
    channel: 'zulip_dm',
    externalId: String(n),
    threadKey,
    replyAddress: 'zulip:5005',
    note: `note ${n}`,
    untrustedParts: [{ source: 'chat_quote', text: `quoted ${n}` }],
    receivedAt: new Date(at),
    recordedAt: new Date(at),
  };
}

function reply(row: AssistantRequestRow): AssistantEffectRow {
  return {
    id: row.id.replace('-0000000001', '-0000000002'),
    harnessId,
    requestId: row.id,
    kind: 'reply_to_requester',
    idempotencyKey: replyKeyOf(row.id),
    payload: { text: `reply to ${row.note}` },
    createdAt: row.recordedAt,
  };
}

describe('PA-2 a thread carries its earlier exchanges', () => {
  it('pairs each earlier note with its reply, oldest first', () => {
    const first = request(1, start);
    const second = request(2, start + hour);
    const current = request(3, start + 2 * hour);
    const history = historyOf(current, [second, first, current], [reply(second), reply(first)]);
    expect(history).toEqual([
      { role: 'user', text: 'note 1' },
      { role: 'assistant', text: 'reply to note 1', toolCalls: [] },
      { role: 'user', text: 'note 2' },
      { role: 'assistant', text: 'reply to note 2', toolCalls: [] },
    ]);
  });

  it('never replays an earlier untrusted part', () => {
    const first = request(1, start);
    const current = request(2, start + hour);
    const history = JSON.stringify(historyOf(current, [first, current], [reply(first)]));
    expect(history).not.toContain('quoted');
  });

  it('keeps only the last six pairs from the same thread within seven days', () => {
    const earlier = Array.from({ length: 9 }, (_, n) => request(n + 1, start + n * hour));
    const current = request(20, start + 10 * hour);
    const old = request(30, start + 10 * hour - 8 * day);
    const elsewhere = request(40, start + 9 * hour, 'other');
    const rows = [...earlier, old, elsewhere, current];
    const history = historyOf(current, rows, rows.map(reply));
    const notes = history.filter((message) => message.role === 'user').map((m) => m.text);
    expect(notes).toEqual(['note 4', 'note 5', 'note 6', 'note 7', 'note 8', 'note 9']);
    expect(notes).toHaveLength(HISTORY_PAIRS);
  });

  it('leaves out a request with no reply and a request with no thread', () => {
    const unanswered = request(1, start);
    expect(historyOf(request(2, start + hour), [unanswered], [])).toEqual([]);
    const loose = request(3, start + hour, null);
    expect(historyOf(loose, [request(4, start, null)], [reply(request(4, start, null))])).toEqual(
      [],
    );
  });
});
