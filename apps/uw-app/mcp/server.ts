import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION } from '@uw/contracts';
import type { VerbContext } from './context.ts';
import { assertGatedWhereGranted, callVerb, resultOf } from './dispatch.ts';
import type { VerbHandler, VerbRefusal } from './handler.ts';
import { toolsFor } from './tools.ts';
import { verbHandlers } from './verbs/index.ts';

export type ServedLimits = {
  readonly tools: ReadonlySet<string> | null;
  guard(): Promise<VerbRefusal | null>;
};

const unlimited: ServedLimits = { tools: null, guard: () => Promise.resolve(null) };

export function createVerbServer(
  context: VerbContext,
  handlers: ReadonlyMap<string, VerbHandler> = verbHandlers,
  limits: ServedLimits = unlimited,
): Server {
  assertGatedWhereGranted(handlers);
  const server = new Server(
    { name: 'uw-platform', version: CONTRACT_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );
  const offered = (name: string) => limits.tools === null || limits.tools.has(name);
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolsFor(context.principal, context.at).filter((tool) => offered(tool.name)),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    if (!offered(name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    const held = await limits.guard();
    if (held !== null) return resultOf(held);
    return callVerb(context, name, request.params.arguments, handlers);
  });
  return server;
}
