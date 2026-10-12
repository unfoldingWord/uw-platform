import { describe, expect, it } from 'vitest';
import { gateLink, homeLink } from '@uw/contracts';
import type { Wake } from '@uw/harness';
import { reasonSentence, zulipContent } from './message.ts';

const harnessId = 'c7000000-0000-4000-8000-000000000001';
const itemId = 'c7000000-0000-4000-8000-000000000002';
const origin = 'https://app.example.org';

const itemWake: Wake = {
  harnessId,
  harnessKey: 'software',
  jdArea: '80-89',
  itemId,
  itemRef: 'uw-platform#42',
  topic: 'software/uw-platform#42',
  reason: 'gate_waiting',
  link: gateLink(harnessId, itemId),
  recipients: [{ personId: 'c7000000-0000-4000-8000-000000000003', present: false }],
  at: new Date('2026-10-04T09:00:00.000Z'),
  traceId: 'c7000000-0000-4000-8000-000000000004',
};

describe('the Zulip post', () => {
  it('NT-3 a Zulip post names the harness, the item ref, the reason and the link and nothing else', () => {
    const content = zulipContent(itemWake, origin);
    expect(content).toBe(
      `software · uw-platform#42: A gate is waiting on a person. ${origin}/harnesses/${harnessId}/gates/${itemId}`,
    );
    expect(content).not.toContain('Secret plan');
    expect(content).not.toContain('@');
    expect(content).not.toContain(itemWake.recipients[0]?.personId ?? 'none');
  });

  it('a harness-level lapse names the harness and the sentence with no item ref', () => {
    const lapse: Wake = {
      ...itemWake,
      itemId: null,
      itemRef: null,
      topic: 'software',
      reason: 'delegation_lapsed',
      link: homeLink,
    };
    expect(zulipContent(lapse, origin)).toBe(`software: A delegation lapsed. ${origin}/`);
  });

  it('names each posting reason in one fixed sentence', () => {
    expect(reasonSentence).toEqual({
      gate_waiting: 'A gate is waiting on a person',
      delegation_lapsed: 'A delegation lapsed',
      run_failed: 'A run failed',
    });
  });
});
