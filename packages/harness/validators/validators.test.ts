import {
  evidenceLabelSchema,
  newEventSchema,
  type HarnessEvent,
  type PageStatus,
  type PageType,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { replay } from '../items/fold.ts';
import type { PageFacts } from '../ports.ts';
import { checkClaims, claimLabel } from './claims.ts';
import { attachedPageIds } from './learning-attached.ts';
import type { ValidationContext } from './context.ts';
import { runValidators, validatorRegistry } from './registry.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const pageA = '00000000-0000-4000-8000-0000000000c1';
const pageB = '00000000-0000-4000-8000-0000000000c2';
const human = 'human:00000000-0000-4000-8000-000000000001';
const noMarker =
  'learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker';

function event(n: number, name: string, actor: string, evidence: Record<string, unknown>) {
  return {
    ...newEventSchema.parse({
      eventId: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
      harnessId,
      itemId,
      name,
      at: new Date(Date.parse('2026-10-01T09:00:00.000Z') + n * 1000).toISOString(),
      actor,
      evidence,
      traceId: '00000000-0000-4000-8000-0000000000e1',
    }),
    position: n,
  } satisfies HarnessEvent;
}

function created(): HarnessEvent {
  return event(1, 'item_created', 'agent:builder', {
    stage: 'build',
    title: 'Item',
    pageId: null,
    priority: 0,
    due: null,
  });
}

function attached(n: number, pageId: string): HarnessEvent {
  return event(n, 'learning_attached', 'agent:builder', { pageId });
}

function nothingLearned(actor: string): HarnessEvent {
  return event(9, 'nothing_learned', actor, { reason: 'routine change' });
}

function page(id: string, type: PageType, status: PageStatus, bodyMd: string): PageFacts {
  return { id, type, status, jdArea: '11', bodyMd };
}

function contextOf(
  events: readonly HarnessEvent[],
  pages: readonly PageFacts[] = [],
): ValidationContext {
  const item = replay(events);
  if (item === null) throw new Error('no item');
  return { item, events, pages: new Map(pages.map((p) => [p.id, p])) };
}

function failures(events: readonly HarnessEvent[], pages: readonly PageFacts[] = []) {
  return runValidators(['learning_attached'], contextOf(events, pages));
}

describe('KN-6 validators are a registry and an unknown key fails closed', () => {
  it('names the unknown key, passes an empty list, and registers learning_attached only', () => {
    const context = contextOf([created()]);
    expect(runValidators(['nope'], context)).toEqual(['unknown_validator: nope']);
    expect(runValidators([], context)).toEqual([]);
    expect([...validatorRegistry.keys()]).toEqual(['learning_attached']);
  });

  it('concatenates the failures of every key', () => {
    const context = contextOf([created()]);
    expect(runValidators(['learning_attached', 'nope'], context)).toEqual([
      noMarker,
      'unknown_validator: nope',
    ]);
  });
});

describe('KN-7 learning_attached passes on a suggested learning, a skill, or a signed nothing-learned marker', () => {
  it('fails with no attachment and no marker', () => {
    expect(failures([created()])).toEqual([noMarker]);
  });

  it('passes an attached suggested learning with a labelled claim', () => {
    const body = '- [observed] the board loads in 300 ms';
    expect(
      failures([created(), attached(2, pageA)], [page(pageA, 'learning', 'suggested', body)]),
    ).toEqual([]);
  });

  it('passes an active skill with no list lines', () => {
    expect(
      failures([created(), attached(2, pageA)], [page(pageA, 'skill', 'active', 'Steps in prose')]),
    ).toEqual([]);
  });

  it('fails a draft learning', () => {
    const body = '- [observed] the board loads in 300 ms';
    expect(
      failures([created(), attached(2, pageA)], [page(pageA, 'learning', 'draft', body)]),
    ).toEqual([noMarker]);
  });

  it('passes a nothing_learned by a human and ignores one by an agent', () => {
    expect(failures([created(), nothingLearned(human)])).toEqual([]);
    expect(failures([created(), nothingLearned('agent:builder')])).toEqual([noMarker]);
  });

  it('names an attached page that does not exist', () => {
    expect(failures([created(), attached(2, pageA)])).toEqual([
      noMarker,
      `learning_attached: page ${pageA} does not exist`,
    ]);
  });

  it('lists attached pages in first-occurrence order without duplicates', () => {
    const events = [created(), attached(2, pageB), attached(3, pageA), attached(4, pageB)];
    expect(attachedPageIds(events)).toEqual([pageB, pageA]);
  });

  it('counts a page attached twice once', () => {
    const body = '- the board is faster';
    const result = failures(
      [created(), attached(2, pageA), attached(3, pageA)],
      [page(pageA, 'learning', 'suggested', body)],
    );
    expect(result).toHaveLength(1);
  });
});

describe('KN-7 every claim carries an evidence label', () => {
  it('fails a claim without a label and names it', () => {
    const result = failures(
      [created(), attached(2, pageA)],
      [page(pageA, 'learning', 'suggested', '- the board is faster')],
    );
    expect(result).toEqual([
      `learning_attached: page ${pageA} has a claim without an evidence label: the board is faster`,
    ]);
  });

  it('fails a learning with no list line', () => {
    const result = failures(
      [created(), attached(2, pageA)],
      [page(pageA, 'learning', 'suggested', 'prose only')],
    );
    expect(result).toEqual([`learning_attached: page ${pageA} states no claim`]);
  });
});

describe('KN-7 the validator checks the labels of every attached suggested page, whatever its type', () => {
  it('checks a persona draft beside a valid learning; attach takes only learnings and skills, so the Iterate revision clause waits for PE-7', () => {
    const result = failures(
      [created(), attached(2, pageA), attached(3, pageB)],
      [
        page(pageA, 'learning', 'suggested', '* [confirmed] the cache hit rate is 90%'),
        page(
          pageB,
          'persona',
          'suggested',
          '- [assumed] reviewers read on phones\n- they prefer short pages',
        ),
      ],
    );
    expect(result).toEqual([
      `learning_attached: page ${pageB} has a claim without an evidence label: they prefer short pages`,
    ]);
  });
});

describe('KN-7 a quoted claim is bounded and claims are counted', () => {
  it('quotes at most 80 characters of a claim and keeps each failure within 500', () => {
    const long = 'x'.repeat(300);
    const result = failures(
      [created(), attached(2, pageA)],
      [page(pageA, 'learning', 'suggested', `- ${long}`)],
    );
    expect(result[0]).toContain(`: ${'x'.repeat(80)}`);
    expect(result[0]).not.toContain('x'.repeat(81));
    expect(result[0]?.length).toBeLessThanOrEqual(500);
  });

  it('splits CRLF and unicode line breaks and counts every list marker', () => {
    expect(checkClaims('- [observed] a\r\n- b\r\n')).toEqual({ claims: 2, unlabelled: ['b'] });
    expect(checkClaims('- [observed] a\u2028- b\u2029- c')).toEqual({
      claims: 3,
      unlabelled: ['b', 'c'],
    });
    expect(checkClaims('- [observed] a\n+ plain\n1. numbered\n2) paren')).toEqual({
      claims: 4,
      unlabelled: ['plain', 'numbered', 'paren'],
    });
  });

  it('fails a CRLF body with an unlabelled claim naming it', () => {
    const body = '- [observed] fast\r\n- slow\r\n';
    expect(
      failures([created(), attached(2, pageA)], [page(pageA, 'learning', 'suggested', body)]),
    ).toEqual([`learning_attached: page ${pageA} has a claim without an evidence label: slow`]);
  });

  it('counts claims and lists the unlabelled ones', () => {
    expect(checkClaims('intro\n- [observed] a\n- b\n  * [inferred] c')).toEqual({
      claims: 3,
      unlabelled: ['b'],
    });
  });

  it('claimLabel alternatives equal the evidence labels', () => {
    expect(claimLabel.source).toBe(`^\\[(${evidenceLabelSchema.options.join('|')})\\]\\s+\\S`);
  });
});
