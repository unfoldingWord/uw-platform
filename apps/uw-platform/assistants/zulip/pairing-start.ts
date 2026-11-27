import type { Caller, Kernel, KernelOutcome } from '@uw/harness';
import { newPairingCode } from './pairing-code.ts';

export type StartedZulipPairing = { readonly code: string; readonly expiresAt: Date };

export async function startZulipPairing(
  kernel: Kernel,
  caller: Caller,
  harnessId: string,
  random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count)),
): Promise<KernelOutcome<StartedZulipPairing>> {
  const { code, digest } = await newPairingCode(random);
  const started = await kernel.assistants.startPairing(caller, {
    harnessId,
    channel: 'zulip_dm',
    codeDigest: digest,
  });
  return started.status === 'accepted'
    ? { status: 'accepted', value: { code, expiresAt: started.value.expiresAt } }
    : started;
}
