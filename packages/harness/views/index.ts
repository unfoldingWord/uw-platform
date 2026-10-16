import type { GateView, Harness, ItemState, ShadowComparison, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { gateView } from '../gates/view.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { boardView } from './board.ts';
import { delegatedMerges, type DelegatedMergeRow } from './delegated-merges.ts';
import { flowView } from './flow.ts';
import { decidableGates, decideAbility, gateDecided } from './gates.ts';
import { planeList } from './plane-list.ts';
import { planeTotals } from './plane.ts';
import { personaView, type PersonaDashboard } from './persona.ts';
import { playByPlay, type PlayInput } from './play.ts';
import { shadowComparison } from './shadow.ts';
import { harnessCursor, harnessCursors, readableHarnesses } from './readable.ts';
import type {
  BoardInput,
  BoardView,
  DecideAbility,
  FlowView,
  GateList,
  HarnessCursor,
  PlaneIndicator,
  PlaneRow,
  PlaneTotals,
  PlayByPlay,
  Waiting,
} from './types.ts';
import { waitingOn } from './waiting.ts';

type ReadOptions = { readonly at: Date };
type ViewPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'store'>;
type Gate = { readonly harness: Harness; readonly stage: Stage; readonly item: ItemState };

export type ViewReads = {
  harnesses(caller: Caller, options?: ReadOptions): Promise<readonly Harness[]>;
  flow(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<FlowView>>;
  board(
    caller: Caller,
    input: BoardInput,
    options?: ReadOptions,
  ): Promise<KernelOutcome<BoardView>>;
  gates(caller: Caller, options?: ReadOptions): Promise<GateList>;
  delegatedMerges(caller: Caller, options?: ReadOptions): Promise<readonly DelegatedMergeRow[]>;
  gate(
    caller: Caller,
    input: { readonly itemId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<GateView>>;
  decideAbility(caller: Caller, gate: Gate, options?: ReadOptions): DecideAbility;
  shadow(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<ShadowComparison>>;
  decided(
    caller: Caller,
    input: { readonly itemId: string },
    options?: ReadOptions,
  ): Promise<boolean>;
  waitingOn(caller: Caller, options?: ReadOptions): Promise<Waiting>;
  playByPlay(
    caller: Caller,
    input: PlayInput,
    options?: ReadOptions,
  ): Promise<KernelOutcome<PlayByPlay>>;
  cursor(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<number>;
  cursors(caller: Caller, options?: ReadOptions): Promise<readonly HarnessCursor[]>;
  persona(
    caller: Caller,
    input: { readonly pageId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<PersonaDashboard>>;
  planeTotals(options?: ReadOptions): Promise<PlaneTotals>;
  planeList(
    caller: Caller,
    indicator: PlaneIndicator,
    options?: ReadOptions,
  ): Promise<readonly PlaneRow[]>;
};

function personaOf(ports: ViewPorts, caller: Caller, pageId: string, at: Date) {
  return ports.store.transaction((tx) => personaView(ports, tx, caller, pageId, at));
}

function mergesOf(ports: ViewPorts, caller: Caller, at: Date) {
  return ports.store.transaction((tx) => delegatedMerges(ports, tx, caller, at));
}

export function createViewReads(ports: ViewPorts): ViewReads {
  const instant = (options?: ReadOptions): Date => options?.at ?? ports.clock.now();
  const { store } = ports;
  return {
    harnesses: (caller, options) => {
      const at = instant(options);
      return store.transaction((tx) => readableHarnesses(ports, tx, caller, at));
    },
    flow: (caller, input, options) => {
      const at = instant(options);
      return store.transaction((tx) => flowView(ports, tx, caller, input.harnessId, at));
    },
    board: (caller, input, options) => {
      const at = instant(options);
      return store.transaction((tx) => boardView(ports, tx, caller, input, at));
    },
    gates: (caller, options) => {
      const at = instant(options);
      return store.transaction((tx) => decidableGates(ports, tx, caller, at));
    },
    delegatedMerges: (caller, options) => mergesOf(ports, caller, instant(options)),
    gate: (caller, input, options) => gateView(ports, caller, input, { at: instant(options) }),
    shadow: (caller, input, options) => shadowComparison(ports, caller, input, instant(options)),
    decideAbility: (caller, gate, options) => decideAbility(caller.actor, gate, instant(options)),
    decided: (caller, { itemId }, options) =>
      store.transaction((tx) => gateDecided(ports, tx, caller, itemId, instant(options))),
    waitingOn: (caller, options) => {
      const at = instant(options);
      return store.transaction((tx) => waitingOn(ports, tx, caller, at));
    },
    playByPlay: (caller, input, options) => {
      const at = instant(options);
      return store.transaction((tx) => playByPlay(ports, tx, caller, input, at));
    },
    cursor: (caller, input, options) => {
      const at = instant(options);
      return store.transaction((tx) => harnessCursor(ports, tx, caller, input.harnessId, at));
    },
    cursors: (caller, options) => {
      const at = instant(options);
      return store.transaction((tx) => harnessCursors(ports, tx, caller, at));
    },
    persona: (caller, input, options) => personaOf(ports, caller, input.pageId, instant(options)),
    planeTotals: (options) => store.transaction((tx) => planeTotals(tx, instant(options))),
    planeList: (caller, indicator, options) => {
      const at = instant(options);
      return store.transaction((tx) => planeList({ ports, tx, caller, at }, indicator));
    },
  };
}
