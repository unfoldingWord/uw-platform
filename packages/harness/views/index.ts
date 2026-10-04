import type { GateView, Harness, ItemState, Stage } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { gateView } from '../gates/view.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { boardView } from './board.ts';
import { flowView } from './flow.ts';
import { decidableGates, decideAbility, gateDecided } from './gates.ts';
import { planeList } from './plane-list.ts';
import { planeTotals } from './plane.ts';
import { playByPlay, type PlayInput } from './play.ts';
import { harnessCursor, harnessCursors, readableHarnesses } from './readable.ts';
import type {
  BoardInput,
  BoardView,
  DecideAbility,
  FlowView,
  GateRow,
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
  gates(caller: Caller, options?: ReadOptions): Promise<readonly GateRow[]>;
  gate(
    caller: Caller,
    input: { readonly itemId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<GateView>>;
  decideAbility(caller: Caller, gate: Gate, options?: ReadOptions): DecideAbility;
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
  planeTotals(options?: ReadOptions): Promise<PlaneTotals>;
  planeList(
    caller: Caller,
    indicator: PlaneIndicator,
    options?: ReadOptions,
  ): Promise<readonly PlaneRow[]>;
};

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
    gate: (caller, input, options) => gateView(ports, caller, input, { at: instant(options) }),
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
    planeTotals: (options) => {
      const at = instant(options);
      return store.transaction((tx) => planeTotals(tx, at));
    },
    planeList: (caller, indicator, options) => {
      const at = instant(options);
      return store.transaction((tx) => planeList({ ports, tx, caller, at }, indicator));
    },
  };
}
