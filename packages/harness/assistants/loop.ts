import type { Engine, VerbName } from '@uw/contracts';
import type { AssistantRequestRow, StoreTransaction, TurnMessage } from '../ports.ts';
import type { RunPersona } from '../runs/types.ts';
import { renderUntrusted, untrusted } from '../untrusted.ts';
import { HISTORY_PAIRS, HISTORY_WINDOW_MS, historyOf } from './history.ts';
import { instructionsOf } from './instructions.ts';
import { ASSISTANT_TOOLSET, ASSISTANT_TURN_LIMIT } from './role.ts';

export type AssistantLoop = {
  readonly engine: Engine;
  readonly model: string;
  readonly pinnedProvider: string | null;
  readonly persona: string;
  readonly instructions: string;
  readonly tools: readonly VerbName[];
  readonly traceId: string;
  readonly turnLimit: number;
  readonly history: readonly TurnMessage[];
  readonly prompt: string;
};

export type LoopScene = {
  readonly request: AssistantRequestRow;
  readonly persona: RunPersona;
  readonly at: Date;
  readonly traceId: string;
};

const roleTools: ReadonlySet<VerbName> = new Set(ASSISTANT_TOOLSET);

export function promptOf(request: AssistantRequestRow): string {
  const parts = request.untrustedParts.map((part) =>
    renderUntrusted(untrusted({ source: part.source, itemId: null, text: part.text })),
  );
  return [request.note, ...parts].join('\n\n');
}

export function toolsOf(persona: Pick<RunPersona, 'toolset'>): readonly VerbName[] {
  return persona.toolset.filter((verb) => roleTools.has(verb));
}

async function threadHistory(
  tx: StoreTransaction,
  request: AssistantRequestRow,
): Promise<readonly TurnMessage[]> {
  const { threadKey } = request;
  if (threadKey === null) return [];
  const requests = await tx.assistantRequests.read.deliveredInThread({
    harnessId: request.harnessId,
    channel: request.channel,
    threadKey,
    before: { recordedAt: request.recordedAt, id: request.id },
    since: new Date(request.recordedAt.getTime() - HISTORY_WINDOW_MS),
    limit: HISTORY_PAIRS,
  });
  const effects = await tx.assistantEffects.read.forRequests(requests.map((row) => row.id));
  return historyOf(request, requests, effects);
}

export async function loopOf(tx: StoreTransaction, scene: LoopScene): Promise<AssistantLoop> {
  const { request, persona, at } = scene;
  const settings = await tx.assistantSettings.read.byHarness(request.harnessId);
  return {
    engine: persona.engine,
    model: persona.model,
    pinnedProvider: persona.provider,
    persona: persona.identity,
    instructions: instructionsOf(persona.instructions, settings, {
      now: at,
      channel: request.channel,
    }),
    tools: toolsOf(persona),
    traceId: scene.traceId,
    turnLimit: ASSISTANT_TURN_LIMIT,
    history: await threadHistory(tx, request),
    prompt: promptOf(request),
  };
}
