import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { isForbiddenVerbName, verbRegistry } from '@uw/contracts';
import { gatedHandler, type VerbHandler } from '../mcp/handler.ts';
import { serveVerbsForTest } from './in-process.ts';
import { toolsFor } from '../mcp/tools.ts';
import { verbHandlers } from '../mcp/verbs/index.ts';
import { callableFailures, toolSurfaceMismatches, type ToolSurface } from './conformance.ts';
import { areaGrant, testAgent, testContext } from './mcp.ts';

const AT = new Date('2026-10-02T12:00:00.000Z');
const HARNESS = '00000000-0000-4000-8000-000000001905';

function servedNames(): string[] {
  return verbRegistry
    .filter((verb) => verb.servedInV1 && !isForbiddenVerbName(verb.name))
    .map((verb) => verb.name);
}

function registryTools(): Tool[] {
  return toolsFor(testAgent([areaGrant('editor', '80-89')]), AT);
}

function surfacesWith(workflow: Tool[]): ToolSurface[] {
  return [
    { host: 'workflow', tools: workflow },
    { host: 'external', tools: registryTools() },
  ];
}

const approveItem: Tool = { name: 'approve_item', inputSchema: { type: 'object' } };

function widened(tool: Tool): Tool {
  if (tool.name !== 'claim_item') return tool;
  return { ...tool, inputSchema: { ...tool.inputSchema, required: [] } };
}

async function callInProcess(
  name: string,
  args: Record<string, unknown>,
  handlers: ReadonlyMap<string, VerbHandler> = verbHandlers,
): Promise<unknown> {
  const context = testContext(testAgent([areaGrant('editor', '80-89')]));
  const client = await serveVerbsForTest(context, handlers);
  try {
    return await client.callTool({ name, arguments: args }).then(
      (result) => result,
      (error: unknown) => error,
    );
  } finally {
    await client.close();
  }
}

const throwingHealth = gatedHandler({
  name: 'get_health',
  hidden: () => ({ status: 'error', reason: 'harness_not_found', detail: {} }),
  resource: async () => {
    throw new RangeError('planted failure on the workflow host');
  },
  run: async () => ({ status: 'error', reason: 'harness_not_found', detail: {} }),
});

function refused(reason: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ status: 'error', reason, detail: {} }) }],
    isError: true,
  };
}

describe('AB-7 the conformance check fails on a planted host-specific tool', () => {
  it('passes the registry served to both hosts', () => {
    expect(toolSurfaceMismatches(surfacesWith(registryTools()), servedNames())).toEqual([]);
  });

  it('names a tool only the workflow host serves', () => {
    const mismatches = toolSurfaceMismatches(
      surfacesWith([...registryTools(), approveItem]),
      servedNames(),
    );
    expect(mismatches).toEqual([
      'workflow serves unregistered approve_item',
      'approve_item is served by only one of workflow and external',
    ]);
  });

  it('names a verb the workflow host does not serve', () => {
    const tools = registryTools().filter((tool) => tool.name !== 'poll_queue');
    expect(toolSurfaceMismatches(surfacesWith(tools), servedNames())).toEqual([
      'workflow lacks poll_queue',
      'poll_queue is served by only one of workflow and external',
    ]);
  });

  it('names a verb whose input schema differs between hosts', () => {
    const tools = registryTools().map(widened);
    expect(toolSurfaceMismatches(surfacesWith(tools), servedNames())).toEqual([
      'claim_item inputSchema differs between workflow and external',
    ]);
  });
});

describe('AB-7 the conformance check fails on a verb a host cannot answer as pinned', () => {
  it('names a verb a host answers as an unknown tool', async () => {
    const outcome = await callInProcess('list_gifts', { since: '2026-01-01' });
    const results = [{ verb: 'list_gifts', outcome, expected: 'accepted' as const }];
    expect(callableFailures('workflow', results)).toEqual([
      'workflow answered list_gifts as an unknown tool',
    ]);
  });

  it('names a verb answered with an open refusal or an output outside its schema', () => {
    const wrong = { content: [{ type: 'text', text: '{}' }], structuredContent: { pages: 1 } };
    const results = [
      { verb: 'claim_item', outcome: refused('boom'), expected: 'accepted' as const },
      { verb: 'search_pages', outcome: wrong, expected: 'accepted' as const },
    ];
    expect(callableFailures('external', results)).toEqual([
      'external answered claim_item with neither its output nor a closed refusal',
      'external answered search_pages with neither its output nor a closed refusal',
    ]);
  });

  it('names internal_error, not_wired and malformed_command even where they were pinned', () => {
    const results = (['internal_error', 'not_wired', 'malformed_command'] as const).map(
      (reason) => ({ verb: 'claim_item', outcome: refused(reason), expected: reason }),
    );
    expect(callableFailures('external', results)).toEqual([
      'external answered claim_item internal_error',
      'external answered claim_item not_wired',
      'external answered claim_item malformed_command',
    ]);
  });

  it('names a closed refusal where the scene pins the verb as accepted', () => {
    const results = [
      { verb: 'claim_item', outcome: refused('item_not_found'), expected: 'accepted' as const },
    ];
    expect(callableFailures('workflow', results)).toEqual([
      'workflow answered claim_item item_not_found, not accepted',
    ]);
  });

  it('names a planted handler that throws on the workflow host', async () => {
    const planted = new Map(verbHandlers);
    planted.set('get_health', throwingHealth);
    const outcome = await callInProcess('get_health', { harnessId: HARNESS }, planted);
    const results = [{ verb: 'get_health', outcome, expected: 'accepted' as const }];
    expect(callableFailures('workflow', results)).toEqual([
      'workflow answered get_health internal_error',
    ]);
  });
});
