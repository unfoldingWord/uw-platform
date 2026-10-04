import type { Grant, RiskDomain } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { GrantHolder } from '../ports.ts';
import { areaAdmins, deciders, personBehind } from './recipients.ts';
import { itemRefOf, topicFor } from './topic.ts';

const at = new Date('2026-10-03T09:00:00.000Z');
const person = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`;
const delegationId = '00000000-0000-4000-8000-0000000004d1';
const harness = { jdArea: '80-89' } as const;

function grant(role: Grant['role'], area: string | null): Grant {
  return area === null
    ? { grantId: person(90), role, scopeKind: 'org', scopeArea: null, expiresAt: null }
    : { grantId: person(91), role, scopeKind: 'jd_area', scopeArea: area, expiresAt: null };
}

function holder(n: number, ...grants: Grant[]): GrantHolder {
  return { personId: person(n), email: `p${n}@example.org`, grants };
}

const holders = [
  holder(1, grant('admin', null)),
  holder(2, grant('admin', '80-89')),
  holder(3, grant('editor', '80-89')),
  holder(4, grant('viewer', '80-89')),
  holder(5, grant('admin', '10-19'), grant('viewer', '80-89')),
];

const item = (riskDomains: RiskDomain[]) => ({ riskDomains });

describe('the person behind an identity', () => {
  const lookup = (id: string) => (id === delegationId ? person(7) : null);

  it.each([
    [`human:${person(1)}`, person(1)],
    [`agent:${person(2)}/laptop`, person(2)],
    [`agent:${person(3)}/laptop as builder via delegation:${delegationId}`, person(3)],
    ['agent:builder', null],
    ['agent:system', null],
  ])('%s is %s', (identity, expected) => {
    expect(personBehind(identity, lookup)).toBe(expected);
  });

  it('answers null for no identity', () => {
    expect(personBehind(null, lookup)).toBeNull();
  });
});

describe('who can decide a gate', () => {
  it('keeps the org admin and the area admin for a standard item, never an editor or viewer', () => {
    expect(deciders(holders, harness, item([]), at)).toEqual([person(1), person(2)]);
  });

  it('keeps only the org admin for an item touching access control', () => {
    expect(deciders(holders, harness, item(['acl']), at)).toEqual([person(1)]);
  });

  it('names every admin on the area', () => {
    expect(areaAdmins(holders, harness, at)).toEqual([person(1), person(2)]);
  });
});

describe('the item ref and the Zulip topic', () => {
  const itemId = '0000abcd-0000-4000-8000-000000000001';

  it('names a wrapped issue by repository and number, else by the item id', () => {
    const issue = { repo: 'unfoldingWord/uw-platform', number: 42, githubId: 7 };
    expect(itemRefOf({ itemId, issue })).toBe('uw-platform#42');
    expect(itemRefOf({ itemId, issue: null })).toBe('item-0000abcd');
  });

  it('joins the harness key and the ref, or names the harness alone', () => {
    expect(topicFor('software', 'uw-platform#42')).toBe('software/uw-platform#42');
    expect(topicFor('software', null)).toBe('software');
  });

  it('cuts the topic to 60 characters with no trailing space', () => {
    expect(topicFor('k'.repeat(58), 'abc')).toBe(`${'k'.repeat(58)}/a`);
    expect(topicFor('software', `${'r'.repeat(50)}  x`)).toBe(`software/${'r'.repeat(50)}`);
  });
});
