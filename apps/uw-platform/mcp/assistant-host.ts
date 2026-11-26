import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION, type Principal, type VerbName } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { ASSISTANT_TOOLSET, ASSISTANT_VERBS, type Kernel, type ToolCaller } from '@uw/harness';
import type { SpendCap } from '../health/spend-cap.ts';
import type { AssistantTurnAddress, VerbContext } from './context.ts';
import type { VerbHandler } from './handler.ts';
import { createVerbServer } from './server.ts';
import { verbHandlers } from './verbs/index.ts';

export type AssistantHostConnection = {
  readonly kernel: Kernel;
  readonly principal: Principal;
  readonly turn: AssistantTurnAddress;
  readonly tools: readonly VerbName[];
  readonly at: Date;
  readonly traceId: string;
  readonly db: Database;
  readonly commit: string;
  readonly cap: SpendCap;
  readonly logger: Logger;
};

export type AssistantHost = { readonly tools: ToolCaller; close(): Promise<void> };

const hostVerbs: ReadonlySet<VerbName> = new Set<VerbName>([
  ...ASSISTANT_TOOLSET,
  ...ASSISTANT_VERBS,
]);

type CallResult = Awaited<ReturnType<Client['callTool']>>;

function outputOf(result: CallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const [first] = Array.isArray(result.content) ? result.content : [];
  const text: unknown = first !== undefined && 'text' in first ? first.text : null;
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function servedOnly(verbs: ReadonlySet<string>): ReadonlyMap<string, VerbHandler> {
  return new Map([...verbHandlers].filter(([name]) => verbs.has(name)));
}

function contextOf(connection: AssistantHostConnection): VerbContext {
  const { principal, at, traceId, kernel, db, commit, cap, logger, turn } = connection;
  return { principal, host: 'assistant', at, traceId, kernel, db, commit, cap, logger, turn };
}

function callerOver(client: Client): ToolCaller {
  return {
    call: async (verb, input) => {
      const result = await client.callTool({
        name: verb,
        arguments: typeof input === 'object' && input !== null ? { ...input } : {},
      });
      return { output: outputOf(result), isError: result.isError === true };
    },
  };
}

export async function connectAssistantHost(
  connection: AssistantHostConnection,
): Promise<AssistantHost> {
  const verbs = new Set(connection.tools.filter((verb) => hostVerbs.has(verb)));
  const limits = { tools: verbs, guard: () => Promise.resolve(null) };
  const server = createVerbServer(contextOf(connection), servedOnly(verbs), limits);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client(
    { name: 'uw-assistant-host', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(clientSide);
  return {
    tools: callerOver(client),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
