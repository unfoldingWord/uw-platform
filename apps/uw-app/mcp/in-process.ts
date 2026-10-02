import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION } from '@uw/contracts';
import type { VerbContext } from './context.ts';
import type { VerbHandler } from './handler.ts';
import { createVerbServer } from './server.ts';
import { verbHandlers } from './verbs/index.ts';

export async function connectInProcess(
  context: Omit<VerbContext, 'host'>,
  handlers: ReadonlyMap<string, VerbHandler> = verbHandlers,
): Promise<Client> {
  const server = createVerbServer({ ...context, host: 'workflow' }, handlers);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client(
    { name: 'uw-workflow-host', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(clientSide);
  return client;
}
