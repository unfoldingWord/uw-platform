import type { CommandBody } from '@uw/contracts';
import type { DecideInput, KernelOutcome } from '@uw/harness';
import { commandHandler, fromKernel, type CommandContext } from '../handler.ts';

function notParked(outcome: KernelOutcome<unknown>): boolean {
  if (outcome.status === 'accepted' || outcome.reason !== 'item_not_at_gate') return false;
  return outcome.detail['why'] !== 'moved';
}

async function gateOutcome(context: CommandContext, input: DecideInput) {
  const kernel = context.gateKernel();
  const outcome = await kernel.gates.decide(context.caller, input);
  return outcome;
}

async function decided(context: CommandContext, input: DecideInput) {
  return fromKernel(await gateOutcome(context, input));
}

export const approveCommand = commandHandler({
  name: 'approve',
  action: 'admin',
  agents: 'recorded',
  run: (context, body: CommandBody<'approve'>) =>
    decided(context, {
      itemId: body.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: body.head,
    }),
});

export const rejectCommand = commandHandler({
  name: 'reject',
  action: 'admin',
  agents: 'recorded',
  run: (context, body: CommandBody<'reject'>) =>
    decided(context, {
      itemId: body.itemId,
      decision: 'reject',
      reason: null,
      findings: body.findings,
    }),
});

export const takeOverCommand = commandHandler({
  name: 'take_over',
  action: 'admin',
  agents: 'recorded',
  run: async (context, body: CommandBody<'take_over'>) => {
    const { itemId } = body;
    const input = { itemId, decision: 'take_over' as const, reason: null, findings: [] };
    const atGate = await gateOutcome(context, input);
    if (!notParked(atGate)) return fromKernel(atGate);
    return fromKernel(await context.kernel.runs.takeOver(context.caller, { itemId }));
  },
});

export const overrideCommand = commandHandler({
  name: 'override',
  action: 'admin',
  agents: 'recorded',
  run: (context, body: CommandBody<'override'>) =>
    decided(context, {
      itemId: body.itemId,
      decision: 'override',
      reason: body.reason,
      findings: [],
      seenHead: body.head,
    }),
});

export const recoverConnectorsCommand = commandHandler({
  name: 'recover_connectors',
  action: 'admin',
  run: async (context) => {
    const kernel = context.gateKernel();
    const { caller, harnessId } = context;
    return fromKernel(await kernel.gates.recoverConnectors(caller, { harnessId }));
  },
});

export const decideGatesCommand = commandHandler({
  name: 'decide_gates',
  action: 'admin',
  run: async (context, body: CommandBody<'decide_gates'>) => {
    const kernel = context.gateKernel();
    const input = { harnessId: context.harnessId, entries: body.entries };
    return fromKernel(await kernel.gates.decideGates(context.caller, input));
  },
});

export const refuteFindingCommand = commandHandler({
  name: 'refute_finding',
  action: 'write',
  run: async ({ kernel, caller }, body: CommandBody<'refute_finding'>) => {
    const input = { itemId: body.itemId, runId: body.runId, finding: body.finding };
    return fromKernel(await kernel.gates.refuteFinding(caller, input));
  },
});
