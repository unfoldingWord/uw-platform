import { describe, expect, it } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { areaGrant, testAgent, testContext } from '../testing/mcp.ts';
import { callVerb } from './dispatch.ts';
import { gatedHandler, refusal, rowFilteredHandler, type VerbHandler } from './handler.ts';
import { createVerbServer } from './server.ts';
import { verbHandlers } from './verbs/index.ts';

const ITEM = '00000000-0000-4000-8000-000000000402';
const lease = { itemId: ITEM, leaseExpiresAt: null, leaseWarning: false };

function claimRows(ran: string[]): ReadonlyMap<string, VerbHandler> {
  const handler = rowFilteredHandler({
    name: 'claim_item',
    run: async () => {
      ran.push('claim_item');
      return { status: 'accepted', output: lease };
    },
  });
  return new Map<string, VerbHandler>([[handler.name, handler]]);
}

function claimGated(exists: boolean): ReadonlyMap<string, VerbHandler> {
  const handler = gatedHandler({
    name: 'claim_item',
    hidden: (input) => refusal('item_not_found', { itemId: input.itemId }),
    resource: async (_context, input) =>
      exists
        ? { resource: { kind: 'area', area: '80-89' }, found: null }
        : refusal('item_not_found', { itemId: input.itemId }),
    run: async () => ({ status: 'accepted', output: lease }),
  });
  return new Map<string, VerbHandler>([[handler.name, handler]]);
}

function editor() {
  return testAgent([areaGrant('editor', '80-89')]);
}

function loggedCalls(lines: readonly string[]): Record<string, unknown>[] {
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line['message'] === 'verb call');
}

async function unknownCall(lines: string[], name: string): Promise<unknown> {
  try {
    await callVerb(testContext(editor(), lines), name, {}, verbHandlers);
  } catch (error) {
    return error;
  }
  return null;
}

describe('AB-3 a verb with a registry grant is served only by a gated handler', () => {
  it('refuses to build a server over a rows handler for a granted verb', () => {
    expect(() => createVerbServer(testContext(editor()), claimRows([]))).toThrow(/claim_item/);
  });

  it('builds a server over the registered handlers', () => {
    expect(() => createVerbServer(testContext(editor()))).not.toThrow();
  });

  it('answers a misdeclared handler internal_error and never runs it', async () => {
    const ran: string[] = [];
    const result = await callVerb(
      testContext(editor()),
      'claim_item',
      { itemId: ITEM, delegationId: null },
      claimRows(ran),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: '{"status":"error","reason":"internal_error","detail":{}}' },
    ]);
    expect(ran).toEqual([]);
  });
});

describe('AB-3 a resource the caller cannot read is answered as a missing one', () => {
  it('gives byte-identical replies for a hidden item and a missing item', async () => {
    const viewer = testContext(testAgent([areaGrant('viewer', '20-29')]));
    const args = { itemId: ITEM, delegationId: null };
    const hidden = await callVerb(viewer, 'claim_item', args, claimGated(true));
    const missing = await callVerb(viewer, 'claim_item', args, claimGated(false));
    expect(hidden).toEqual(missing);
    expect(hidden.content).toEqual([
      {
        type: 'text',
        text: `{"status":"error","reason":"item_not_found","detail":{"itemId":"${ITEM}"}}`,
      },
    ]);
  });
});

describe('every verb call is recorded in the request log', () => {
  it('logs a refusal with its reason', async () => {
    const lines: string[] = [];
    const viewer = testContext(testAgent([areaGrant('viewer', '80-89')]), lines);
    await callVerb(viewer, 'claim_item', { itemId: ITEM, delegationId: null }, claimGated(true));
    expect(loggedCalls(lines)).toEqual([
      expect.objectContaining({ outcome: 'not_permitted', verb: 'claim_item' }),
    ]);
  });

  it('logs a forbidden or unknown name as an unknown tool', async () => {
    const lines: string[] = [];
    expect(await unknownCall(lines, 'approve')).toBeInstanceOf(McpError);
    expect(loggedCalls(lines)).toEqual([
      expect.objectContaining({ outcome: 'unknown_tool', verb: 'approve' }),
    ]);
  });

  it('logs an accepted call as accepted', async () => {
    const lines: string[] = [];
    const context = testContext(editor(), lines);
    await callVerb(context, 'claim_item', { itemId: ITEM, delegationId: null }, claimGated(true));
    expect(loggedCalls(lines)).toEqual([
      expect.objectContaining({ outcome: 'accepted', verb: 'claim_item' }),
    ]);
  });
});

describe('malformed arguments name their fields', () => {
  it('names a root-level failure (root)', async () => {
    const result = await callVerb(testContext(editor()), 'claim_item', [], claimGated(true));
    expect(result.content).toEqual([
      {
        type: 'text',
        text: '{"status":"error","reason":"malformed_command","detail":{"fields":["(root)"]}}',
      },
    ]);
  });
});
