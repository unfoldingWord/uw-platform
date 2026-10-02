import { describe, expect, it } from 'vitest';
import type { JdArea } from '@uw/contracts';
import { areaGrant, testAgent, testContext } from '../testing/mcp.ts';
import { callVerb } from './dispatch.ts';
import { rowFilteredHandler, type VerbHandler } from './handler.ts';
import { createVerbServer } from './server.ts';
import { searchPagesVerb } from './verbs/search-pages.ts';

type Row = { readonly id: number; readonly area: JdArea | null };

const rows: readonly Row[] = [
  { id: 1, area: '80-89' },
  { id: 2, area: '20-29' },
  { id: 3, area: null },
];

const searchArgs = { query: 'x', type: null, limit: 5 };

function viewer() {
  return testContext(testAgent([areaGrant('viewer', '80-89')]));
}

function served(handler: VerbHandler): ReadonlyMap<string, VerbHandler> {
  return new Map([[handler.name, handler]]);
}

function handBuilt(ran: string[]): VerbHandler {
  return {
    kind: 'rows',
    name: 'search_pages',
    run: async () => {
      ran.push('search_pages');
      return { status: 'accepted', output: { pages: [] } };
    },
  };
}

const internalError = [
  { type: 'text', text: '{"status":"error","reason":"internal_error","detail":{}}' },
];

describe('AB-3 only a handler builder makes a handler the verb server serves', () => {
  it('refuses at startup a hand-built rows handler', () => {
    expect(() => createVerbServer(viewer(), served(handBuilt([])))).toThrow(/search_pages/);
  });

  it('refuses at startup a spread copy of a built handler', () => {
    const copy: VerbHandler = { ...searchPagesVerb };
    expect(() => createVerbServer(viewer(), served(copy))).toThrow(/search_pages/);
  });

  it('answers a hand-built handler internal_error and never runs it', async () => {
    const ran: string[] = [];
    const result = await callVerb(viewer(), 'search_pages', searchArgs, served(handBuilt(ran)));
    expect(result.content).toEqual(internalError);
    expect(ran).toEqual([]);
  });

  it('freezes a built handler so its run cannot be swapped', () => {
    expect(Reflect.set(searchPagesVerb, 'run', handBuilt([]).run)).toBe(false);
    expect(createVerbServer(viewer(), served(searchPagesVerb))).toBeDefined();
  });
});

describe('AB-3 a row-filtered handler answers only rows the caller can read', () => {
  it('hands its reply only the rows whose area the caller can read', async () => {
    const seen: (readonly Row[])[] = [];
    const handler = rowFilteredHandler({
      name: 'query_entities',
      rows: async () => rows,
      resources: async () => (row) => (row.area === null ? null : { kind: 'area', area: row.area }),
      reply: (visible) => {
        seen.push(visible);
        return { status: 'accepted', output: { rows: [...visible] } };
      },
    });
    const args = { query: 'any_rows', params: {} };
    const result = await callVerb(viewer(), 'query_entities', args, served(handler));
    expect(seen).toEqual([[{ id: 1, area: '80-89' }]]);
    expect(result.structuredContent).toEqual({ rows: [{ id: 1, area: '80-89' }] });
  });
});
