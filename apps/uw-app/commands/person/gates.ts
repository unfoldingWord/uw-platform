import type { CommandBody } from '@uw/contracts';
import type { DecideInput } from '@uw/harness';
import { commandHandler, fromKernel, type CommandContext } from '../handler.ts';

async function decided(context: CommandContext, input: DecideInput) {
  const kernel = context.gateKernel();
  return fromKernel(await kernel.gates.decide(context.caller, input));
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
  run: (context, body: CommandBody<'take_over'>) =>
    decided(context, { itemId: body.itemId, decision: 'take_over', reason: null, findings: [] }),
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
