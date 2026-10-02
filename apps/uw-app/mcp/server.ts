import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION } from '@uw/contracts';
import type { VerbContext } from './context.ts';
import { callVerb } from './dispatch.ts';
import type { VerbHandler } from './handler.ts';
import { toolsFor } from './tools.ts';
import { verbHandlers } from './verbs/index.ts';

export function createVerbServer(
  context: VerbContext,
  handlers: ReadonlyMap<string, VerbHandler> = verbHandlers,
): Server {
  const server = new Server(
    { name: 'uw-platform', version: CONTRACT_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolsFor(context.principal, context.at),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callVerb(context, request.params.name, request.params.arguments, handlers),
  );
  return server;
}
