import { assistantResearchKindSchema, type AssistantResearchKind } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { requestEvents } from './ledger.ts';
import { turnSceneOf, type TurnAddress, type TurnScene } from './reminder-turn.ts';

export type ResearchPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'research'>;
export type ResearchCounts = Readonly<Record<AssistantResearchKind, number>>;
export type Reserved = {
  readonly harnessId: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly mayRender: boolean;
};

export const RESEARCH_PER_REQUEST: ResearchCounts = {
  web_search: 5,
  page_read: 6,
  page_rendered: 2,
  flight_search: 3,
};

export const RESEARCH_PER_DAY: ResearchCounts = {
  web_search: 30,
  page_read: 40,
  page_rendered: 10,
  flight_search: 10,
};

const DAY_MS = 24 * 60 * 60_000;
const RESEARCH_EVENT = 'assistant_research_used';
const DAY_READ_MOST = Object.values(RESEARCH_PER_DAY).reduce((sum, most) => sum + most, 1);

type Counted = ReadonlyMap<AssistantResearchKind, number>;

function counted(kinds: readonly unknown[]): Counted {
  const counts = new Map<AssistantResearchKind, number>();
  for (const kind of kinds) {
    const parsed = assistantResearchKindSchema.safeParse(kind);
    if (parsed.success) counts.set(parsed.data, (counts.get(parsed.data) ?? 0) + 1);
  }
  return counts;
}

function limitOf(table: ResearchCounts, kind: AssistantResearchKind): number {
  return new Map(Object.entries(table)).get(kind) ?? 0;
}

async function usedInRequest(scene: TurnScene): Promise<Counted> {
  const events = await requestEvents(scene.tx, scene.request, [RESEARCH_EVENT]);
  return counted(events.map((event) => event.evidence['kind']));
}

async function usedToday(scene: TurnScene): Promise<Counted> {
  const { tx, context, request } = scene;
  const events = await tx.harnessEvents.read.recent({
    since: new Date(context.at.getTime() - DAY_MS),
    names: [RESEARCH_EVENT],
    agentsOnly: false,
    harnessIds: [request.harnessId],
    limit: DAY_READ_MOST,
  });
  return counted(events.map((event) => event.evidence['kind']));
}

function under(kind: AssistantResearchKind, request: Counted, day: Counted): boolean {
  const inRequest = request.get(kind) ?? 0;
  const inDay = day.get(kind) ?? 0;
  return inRequest < limitOf(RESEARCH_PER_REQUEST, kind) && inDay < limitOf(RESEARCH_PER_DAY, kind);
}

export type Admission = (scene: TurnScene) => Promise<Refused | null>;

const admitted: Admission = async () => null;

async function reservedIn(
  scene: TurnScene,
  kind: AssistantResearchKind,
  turnId: string,
  admit: Admission,
): Promise<Reserved | Refused> {
  const refusal = await admit(scene);
  if (refusal !== null) return refusal;
  const request = await usedInRequest(scene);
  const day = await usedToday(scene);
  if (!under(kind, request, day)) {
    return refused('not_permitted', { why: 'research_capped', kind });
  }
  const { tx, context } = scene;
  const requestId = scene.request.id;
  await recordHarnessEvents(tx, context, scene.request.harnessId, [
    draft(RESEARCH_EVENT, { requestId, turnId, kind }),
  ]);
  return {
    harnessId: scene.request.harnessId,
    requestId,
    turnId,
    mayRender: under('page_rendered', request, day),
  };
}

export function reserveResearch(
  ports: ResearchPorts,
  caller: Caller,
  input: TurnAddress,
  kind: AssistantResearchKind,
  admit: Admission = admitted,
): Promise<Reserved | Refused> {
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    return 'status' in scene ? scene : reservedIn(scene, kind, input.turnId, admit);
  });
}

export function recordRendered(
  ports: ResearchPorts,
  caller: Caller,
  reserved: Reserved,
): Promise<unknown> {
  const context = recordContext(ports, caller, ports.clock.now());
  const { harnessId, requestId, turnId } = reserved;
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.assistantHarness(harnessId));
    return recordHarnessEvents(tx, context, harnessId, [
      draft(RESEARCH_EVENT, { requestId, turnId, kind: 'page_rendered' }),
    ]);
  });
}
