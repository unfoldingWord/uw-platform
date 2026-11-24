import { describe, expect, it } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { areaGrant, testAgent, testContext } from '../testing/mcp.ts';
import type { VerbHandler } from './handler.ts';
import { serveVerbsForTest } from '../testing/in-process.ts';
import { searchPagesVerb } from './verbs/search-pages.ts';

function viewer() {
  return testContext(testAgent([areaGrant('viewer', '80-89')]));
}

function served(handler: VerbHandler): ReadonlyMap<string, VerbHandler> {
  return new Map([[handler.name, handler]]);
}

function handBuilt(): VerbHandler {
  return {
    kind: 'rows',
    name: 'search_pages',
    run: async () => ({ status: 'accepted', output: { pages: [] } }),
  };
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return null;
}

describe('AB-3 an in-process verb server is built through createVerbServer', () => {
  it('refuses an unbranded handler before it connects', async () => {
    await expect(serveVerbsForTest(viewer(), served(handBuilt()))).rejects.toThrow(/search_pages/);
  });

  it('refuses a spread copy of a built handler before it connects', async () => {
    const copy: VerbHandler = { ...searchPagesVerb };
    await expect(serveVerbsForTest(viewer(), served(copy))).rejects.toThrow(/search_pages/);
  });

  it('answers an unserved name with the unknown-tool error', async () => {
    const client = await serveVerbsForTest(viewer());
    const error = await rejection(client.callTool({ name: 'approve_item', arguments: {} }));
    await client.close();
    expect(error instanceof McpError && error.code).toBe(-32602);
    expect(error instanceof Error ? error.message : '').toContain('Unknown tool: approve_item');
  });
});
