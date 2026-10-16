import type { CommandBody } from '@uw/contracts';
import { commandHandler, fromKernel } from '../handler.ts';

export const scheduleRegularTweakCommand = commandHandler({
  name: 'schedule_regular_tweak',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'schedule_regular_tweak'>) => {
    const { persona, capability, supersedes, maxTier } = body;
    const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    const input = { harnessId, persona, capability, maxTier, expiresAt, supersedes };
    return fromKernel(await kernel.delegations.grant(caller, input));
  },
});

export const revokeDelegationCommand = commandHandler({
  name: 'revoke_delegation',
  action: 'admin',
  ownerMayRevoke: true,
  run: async ({ kernel, caller }, body: CommandBody<'revoke_delegation'>) =>
    fromKernel(await kernel.delegations.revoke(caller, { delegationId: body.delegationId })),
});
