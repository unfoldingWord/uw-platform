import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { CONTRACT_VERSION, type VerbName } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Caller, Kernel, KernelOutcome, RunScene } from '@uw/harness';
import type { VerbContext } from './context.ts';
import { refusal, type VerbHandler, type VerbRefusal } from './handler.ts';
import { createVerbServer, type ServedLimits } from './server.ts';
import { verbHandlers } from './verbs/index.ts';

export type RunStepConnection = {
  readonly verbKernel: Kernel;
  readonly runKernel: Kernel;
  readonly host: Caller;
  readonly runId: string;
  readonly at: Date;
  readonly db: Database;
  readonly commit: string;
  readonly logger: Logger;
  readonly within: ReadonlySet<VerbName> | null;
};

export type OpenStep = {
  readonly client: Client;
  readonly core: Client;
  readonly scene: RunScene;
  close(): Promise<void>;
};

const coreVerbs: ReadonlySet<VerbName> = new Set<VerbName>([
  'resolve_context',
  'record_run_step',
  'submit_to_gate',
]);
const hostOnlyVerb: VerbName = 'record_run_step';

function modelVerbs(scene: RunScene, within: ReadonlySet<VerbName> | null): Set<VerbName> {
  return new Set(
    scene.persona.toolset.filter(
      (verb) => verb !== hostOnlyVerb && (within === null || within.has(verb)),
    ),
  );
}

function servedOnly(verbs: ReadonlySet<string>): ReadonlyMap<string, VerbHandler> {
  return new Map([...verbHandlers].filter(([name]) => verbs.has(name)));
}

function sceneGuard(connection: RunStepConnection): () => Promise<VerbRefusal | null> {
  return async () => {
    const found = await connection.runKernel.runs.scene(connection.host, connection.runId);
    return found.status === 'accepted' ? null : refusal(found.reason, found.detail);
  };
}

async function linked(context: VerbContext, verbs: ReadonlySet<string>, limits: ServedLimits) {
  const server = createVerbServer(context, servedOnly(verbs), limits);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client(
    { name: 'uw-workflow-host', version: CONTRACT_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function connectInProcess(
  connection: RunStepConnection,
): Promise<KernelOutcome<OpenStep>> {
  const found = await connection.runKernel.runs.scene(connection.host, connection.runId);
  if (found.status !== 'accepted') return found;
  const scene = found.value;
  const context: VerbContext = {
    principal: scene.principal,
    host: 'workflow',
    at: connection.at,
    traceId: scene.run.traceId,
    kernel: connection.verbKernel,
    db: connection.db,
    commit: connection.commit,
    logger: connection.logger,
  };
  const verbs = modelVerbs(scene, connection.within);
  const model = await linked(context, verbs, { tools: verbs, guard: sceneGuard(connection) });
  const core = await linked(context, coreVerbs, {
    tools: coreVerbs,
    guard: () => Promise.resolve(null),
  });
  return {
    status: 'accepted',
    value: {
      client: model.client,
      core: core.client,
      scene,
      close: async () => {
        await model.close();
        await core.close();
      },
    },
  };
}
