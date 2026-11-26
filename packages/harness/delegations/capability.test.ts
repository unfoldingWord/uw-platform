import { capabilityWordSchema, stageBracketSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { Delegation, PageFacts } from '../ports.ts';
import { capabilityReaches, grantableFor, pageAgrees, policyOf } from './capability.ts';

function reached(capability: (typeof capabilityWordSchema.options)[number]): readonly string[] {
  return stageBracketSchema.options.filter((bracket) => capabilityReaches(capability, bracket));
}

describe('capability brackets', () => {
  it('build and review reach the build package, iterate reaches iterate, none reaches nothing', () => {
    expect(reached('build')).toEqual(['build_package']);
    expect(reached('review')).toEqual(['build_package']);
    expect(reached('iterate')).toEqual(['iterate']);
    expect(reached('none')).toEqual([]);
  });
});

function pageWith(capability: string): PageFacts {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    title: 'Agent',
    bodyMd: '',
    version: 1,
    frontmatter: { capability },
  };
}

function grantOf(capability: (typeof capabilityWordSchema.options)[number]): Delegation {
  return { capability } as Delegation;
}

describe('#110 the kinds of work an agent can be granted', () => {
  it('offers exactly the kinds of work its page agrees with', () => {
    for (const held of capabilityWordSchema.options) {
      const agreed = capabilityWordSchema.options.filter((granted) =>
        pageAgrees(pageWith(held), grantOf(granted)),
      );
      expect(grantableFor(held)).toEqual(agreed.filter((granted) => granted !== 'none'));
    }
  });

  it('lends fix to a builder and offers a reviewer only review', () => {
    expect(grantableFor('build')).toEqual(['build', 'fix']);
    expect(grantableFor('review')).toEqual(['review']);
    expect(grantableFor('fix')).toEqual([]);
  });
});

describe('PA-1 the capability policy registry', () => {
  it('lets only the personal harness person grant assist, which reaches no stage, beat or device', () => {
    const assist = policyOf('assist');
    expect([...assist.reach]).toEqual([]);
    expect(assist).toMatchObject({
      grantor: 'harness_person',
      on: 'personal',
      workflowBeat: false,
      device: false,
    });
    expect(reached('assist')).toEqual([]);
  });

  it('keeps every other word an area admin grant on a workflow harness, beaten and device held', () => {
    const others = capabilityWordSchema.options.filter((word) => word !== 'assist');
    for (const word of others) {
      expect(policyOf(word)).toMatchObject({
        grantor: 'area_admin',
        on: 'workflow',
        workflowBeat: true,
        device: true,
      });
    }
  });

  it('fails closed for a word outside the closed set', () => {
    const unknown = policyOf('teleport' as (typeof capabilityWordSchema.options)[number]);
    expect([...unknown.reach]).toEqual([]);
    expect(unknown).toMatchObject({ workflowBeat: false, device: false });
  });

  it('keeps the reach of the workflow words unchanged', () => {
    expect(reached('fix')).toEqual(['build_package']);
    expect(reached('merge')).toEqual([]);
  });
});
