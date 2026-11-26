import { describe, expect, it } from 'vitest';
import {
  principalSchema,
  verbRegistry,
  WEBSITES_VIEW_ID,
  type Grant,
  type Principal,
} from '@uw/contracts';
import { toolsFor } from './tools.ts';

const OWNER = '00000000-0000-4000-8000-000000000101';
const at = new Date('2026-10-02T12:00:00.000Z');
const FORBIDDEN = ['approve', 'merge', 'deploy', 'publish', 'advance'];

function editorIn(area: string, expiresAt: string | null = null): Grant {
  return {
    grantId: '00000000-0000-4000-8000-000000000201',
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: area,
    expiresAt,
  };
}

function agent(grants: readonly Grant[]): Principal {
  return principalSchema.parse({
    identity: `agent:${OWNER}/laptop`,
    kind: 'agent',
    personId: OWNER,
    email: null,
    grants,
    interactive: true,
  });
}

function holdsForbiddenVerb(name: string): boolean {
  return FORBIDDEN.some((verb) => name.toLowerCase().includes(verb));
}

const giftsServed = verbRegistry.map((verb) =>
  verb.name === 'list_gifts' ? { ...verb, servedInV1: true } : verb,
);

function offersGifts(principal: Principal): boolean {
  return toolsFor(principal, at, giftsServed).some((tool) => tool.name === 'list_gifts');
}

describe('AB-1 the tool list is the served registry and nothing else', () => {
  const tools = toolsFor(agent([editorIn('80-89')]), at);

  it('lists exactly the served verbs, in registry order', () => {
    const served = verbRegistry.filter((verb) => verb.servedInV1).map((verb) => verb.name);
    expect(served).toHaveLength(25);
    expect(tools.map((tool) => tool.name)).toEqual(served);
  });

  it('describes each tool with its registry summary and an object input schema', () => {
    const summaries = new Map<string, string>(
      verbRegistry.map((verb) => [verb.name, verb.summary]),
    );
    for (const tool of tools) {
      expect(tool.description?.startsWith(summaries.get(tool.name) ?? '-')).toBe(true);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema?.type).toBe('object');
    }
  });

  it('tells an agent how to write a measure and walks it through the flow', () => {
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';
    const measure = described('save_measure');
    for (const needed of [
      '{address}',
      'geo-optimizer-skill==4.19.10',
      '["geo", "audit", "--url", "{address}", "--format", "json"]',
      'RFC 6901',
      'collection: "resource"',
      WEBSITES_VIEW_ID,
      'set_property',
      'serves_project',
      'context kind is host',
      'Run trial',
      'read_measure_run',
      'preview_dashboard',
      'Activate',
    ]) {
      expect(measure, needed).toContain(needed);
    }
    expect(described('save_dashboard')).toContain('host takes the page the dashboard is shown on');
    expect(described('read_measure_run')).toContain('resourceId');
    const command = JSON.stringify(tools.find((tool) => tool.name === 'save_measure')?.inputSchema);
    expect(command).toContain('never uvx or uv');
    expect(command).toContain('name==1.2.3');
  });

  it('names no forbidden verb under any case', () => {
    expect(tools.map((tool) => tool.name).filter(holdsForbiddenVerb)).toEqual([]);
  });
});

describe('AB-2 a role-gated verb is offered only to a principal whose owner holds its area grant', () => {
  it('offers list_gifts to an editor of 40-49', () => {
    expect(offersGifts(agent([editorIn('40-49')]))).toBe(true);
  });

  it('does not offer list_gifts to an editor of 80-89', () => {
    expect(offersGifts(agent([editorIn('80-89')]))).toBe(false);
  });

  it('does not offer list_gifts on an expired editor grant for 40-49', () => {
    expect(offersGifts(agent([editorIn('40-49', '2026-10-01T00:00:00.000Z')]))).toBe(false);
  });
});

describe('ADR 0036 the measure guides name the failure path and the canonical address', () => {
  const tools = toolsFor(agent([editorIn('80-89')]), at);
  const described = (name: string) => tools.find((tool) => tool.name === name)?.description ?? '';

  it('tells an agent to set failure_path "/error" for geo audit and record canonical addresses', () => {
    const measure = described('save_measure');
    for (const needed of ['failure_path', '"/error"', 'canonical address', 'www.']) {
      expect(measure, needed).toContain(needed);
    }
  });

  it('says read_measure_run names a failure the output reports at failure_path', () => {
    expect(described('read_measure_run')).toContain('failure_path');
  });
});
