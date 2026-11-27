import type { AssistantChannel, AssistantPairingRefusal, AssistantPairingVia } from '@uw/contracts';
import { isIngestPrincipal, isProvisionerPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantPairingCodeRow, Ports, StoreTransaction } from '../ports.ts';
import { addressRefusal, digestRefusal } from './pairing-input.ts';
import { ownedHarness } from './settings.ts';

export type StartPairingInput = {
  readonly harnessId: string;
  readonly channel: AssistantChannel;
  readonly codeDigest: string;
};
export type StartedPairing = { readonly expiresAt: Date };
export type CompletePairingInput = {
  readonly personId: string;
  readonly channel: AssistantChannel;
  readonly address: string;
  readonly codeDigest: string;
};
export type BindAddressInput = Omit<CompletePairingInput, 'codeDigest'>;
export type Paired = { readonly via: AssistantPairingVia };

type PairingPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;
type Scene = { readonly ports: PairingPorts; readonly caller: Caller; readonly at: Date };
type Bind = BindAddressInput & { readonly harnessId: string; readonly via: AssistantPairingVia };

const CODE_LIFETIME_MS = 10 * 60_000;
const ATTEMPTS = 5;

function refusedPairing(why: AssistantPairingRefusal): Refused {
  return refused('not_permitted', { why });
}

async function recordPairing(
  scene: Scene,
  tx: StoreTransaction,
  harnessId: string,
  event: ReturnType<typeof draft>,
): Promise<void> {
  await recordHarnessEvents(tx, recordContext(scene.ports, scene.caller, scene.at), harnessId, [
    event,
  ]);
}

async function refusedAndRecorded(
  scene: Scene,
  tx: StoreTransaction,
  code: AssistantPairingCodeRow,
  why: AssistantPairingRefusal,
): Promise<Refused> {
  await recordPairing(
    scene,
    tx,
    code.harnessId,
    draft('assistant_pairing_refused', { channel: code.channel, why }),
  );
  return refusedPairing(why);
}

async function bindIn(
  scene: Scene,
  tx: StoreTransaction,
  bind: Bind,
): Promise<KernelOutcome<Paired>> {
  const holder = await tx.assistantBindings.read.byAddress(bind.channel, bind.address);
  if (holder !== null && holder.harnessId !== bind.harnessId)
    return refusedPairing('address_taken');
  await tx.assistantBindings.write.put({
    harnessId: bind.harnessId,
    personId: bind.personId,
    channel: bind.channel,
    address: bind.address,
    via: bind.via,
    boundAt: scene.at,
  });
  await recordPairing(
    scene,
    tx,
    bind.harnessId,
    draft('assistant_paired', { channel: bind.channel, via: bind.via }),
  );
  return accepted({ via: bind.via });
}

async function startIn(
  scene: Scene,
  tx: StoreTransaction,
  input: StartPairingInput,
): Promise<KernelOutcome<StartedPairing>> {
  const owned = await ownedHarness(scene.ports, tx, scene.caller, input.harnessId, scene.at);
  if ('status' in owned) return owned;
  const expiresAt = new Date(scene.at.getTime() + CODE_LIFETIME_MS);
  await tx.assistantPairingCodes.write.put({
    ...owned,
    channel: input.channel,
    codeDigest: input.codeDigest,
    expiresAt,
    attempts: 0,
    createdAt: scene.at,
  });
  await recordPairing(
    scene,
    tx,
    owned.harnessId,
    draft('assistant_pairing_started', { channel: input.channel }),
  );
  return accepted({ expiresAt });
}

async function wrongCode(
  scene: Scene,
  tx: StoreTransaction,
  code: AssistantPairingCodeRow,
): Promise<Refused> {
  const attempts = code.attempts + 1;
  if (attempts >= ATTEMPTS) {
    await tx.assistantPairingCodes.write.remove(code.harnessId, code.channel);
    return refusedAndRecorded(scene, tx, code, 'pairing_attempts_spent');
  }
  await tx.assistantPairingCodes.write.attempted(code.harnessId, code.channel, attempts);
  return refusedAndRecorded(scene, tx, code, 'pairing_code_wrong');
}

async function completeIn(
  scene: Scene,
  tx: StoreTransaction,
  input: CompletePairingInput,
): Promise<KernelOutcome<Paired>> {
  const harness = await tx.harnesses.read.byPerson(input.personId);
  if (harness === null) return refused('no_assistant', { personId: input.personId });
  const code = await tx.assistantPairingCodes.read.of(harness.id, input.channel);
  if (code === null) return refusedPairing('no_pairing');
  if (scene.at.getTime() >= code.expiresAt.getTime()) {
    await tx.assistantPairingCodes.write.remove(code.harnessId, code.channel);
    return refusedAndRecorded(scene, tx, code, 'pairing_code_expired');
  }
  if (code.codeDigest !== input.codeDigest) return wrongCode(scene, tx, code);
  await tx.assistantPairingCodes.write.remove(code.harnessId, code.channel);
  const bound = await bindIn(scene, tx, { ...input, harnessId: harness.id, via: 'pairing_code' });
  return bound.status === 'accepted' ? bound : refusedAndRecorded(scene, tx, code, 'address_taken');
}

async function bindAddressIn(
  scene: Scene,
  tx: StoreTransaction,
  input: BindAddressInput,
): Promise<KernelOutcome<Paired>> {
  const harness = await tx.harnesses.read.byPerson(input.personId);
  if (harness === null) return refused('no_assistant', { personId: input.personId });
  const kept = await tx.assistantBindings.read.of(harness.id, input.channel);
  if (kept !== null) return accepted({ via: kept.via });
  return bindIn(scene, tx, { ...input, harnessId: harness.id, via: 'email_match' });
}

function sceneOf(ports: PairingPorts, caller: Caller): Scene {
  return { ports, caller, at: ports.clock.now() };
}

export function startPairing(
  ports: PairingPorts,
  caller: Caller,
  input: StartPairingInput,
): Promise<KernelOutcome<StartedPairing>> {
  const malformed = digestRefusal(input.codeDigest);
  if (malformed !== null) return Promise.resolve(malformed);
  const scene = sceneOf(ports, caller);
  return ports.store.transaction((tx) => startIn(scene, tx, input));
}

export function completePairing(
  ports: PairingPorts,
  caller: Caller,
  input: CompletePairingInput,
): Promise<KernelOutcome<Paired>> {
  if (!isIngestPrincipal(caller.actor)) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  const malformed = digestRefusal(input.codeDigest) ?? addressRefusal(input);
  if (malformed !== null) return Promise.resolve(malformed);
  const scene = sceneOf(ports, caller);
  return ports.store.transaction((tx) => completeIn(scene, tx, input));
}

export function bindAddress(
  ports: PairingPorts,
  caller: Caller,
  input: BindAddressInput,
): Promise<KernelOutcome<Paired>> {
  if (!isProvisionerPrincipal(caller.actor)) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  const malformed = addressRefusal(input);
  if (malformed !== null) return Promise.resolve(malformed);
  const scene = sceneOf(ports, caller);
  return ports.store.transaction((tx) => bindAddressIn(scene, tx, input));
}
