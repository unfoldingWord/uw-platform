import {
  deviceOwnerSegment,
  delegationIdOf,
  type Harness,
  type ItemState,
  type WakeReason,
} from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { allowed } from '../access.ts';
import type { Delegation, GrantHolder, RunRow } from '../ports.ts';
import type { ItemContext } from './context.ts';
import type { Trigger } from './triggers.ts';
import { approverCovers } from '../risk/domain-grants.ts';

export type DelegationPerson = (delegationId: string) => string | null;

const HUMAN = 'human:';

export function personBehind(
  identity: string | null,
  delegationPerson: DelegationPerson,
): string | null {
  if (identity === null) return null;
  if (identity.startsWith(HUMAN)) return identity.slice(HUMAN.length);
  const owner = deviceOwnerSegment(identity);
  if (owner !== null) return owner;
  const delegationId = delegationIdOf(identity);
  return delegationId === null ? null : delegationPerson(delegationId);
}

function principalOf(holder: GrantHolder) {
  return personPrincipal({ ...holder, interactive: true });
}

function adminOn(holder: GrantHolder, harness: Pick<Harness, 'jdArea'>, at: Date): boolean {
  return allowed(principalOf(holder), 'admin', { jdArea: harness.jdArea }, at);
}

export function deciders(
  holders: readonly GrantHolder[],
  harness: Pick<Harness, 'jdArea'>,
  item: Pick<ItemState, 'riskDomains'>,
  at: Date,
): readonly string[] {
  return holders
    .filter(
      (holder) =>
        adminOn(holder, harness, at) &&
        approverCovers(principalOf(holder), harness.jdArea, item.riskDomains, at),
    )
    .map((holder) => holder.personId);
}

export function areaAdmins(
  holders: readonly GrantHolder[],
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): readonly string[] {
  return holders.filter((holder) => adminOn(holder, harness, at)).map((holder) => holder.personId);
}

export type RecipientScope = {
  readonly trigger: Trigger;
  readonly harness: Harness;
  readonly item: ItemContext | null;
  readonly run: RunRow | null;
  readonly delegation: Delegation | null;
  readonly holders: readonly GrantHolder[];
  readonly delegationPerson: DelegationPerson;
  readonly at: Date;
};

type Named = readonly (string | null)[];

function holderPerson(prior: ItemState | null, delegationPerson: DelegationPerson): string | null {
  if (prior === null || prior.holder === null) return null;
  const behind = personBehind(prior.holder, delegationPerson);
  if (behind !== null || prior.delegationId === null) return behind;
  return delegationPerson(prior.delegationId);
}

function gateWaiting(scope: RecipientScope): Named {
  return scope.item === null
    ? []
    : deciders(scope.holders, scope.harness, scope.item.item, scope.at);
}

function delegationLapsed(scope: RecipientScope): Named {
  if (scope.delegation === null) return [];
  const admins = areaAdmins(scope.holders, scope.harness, scope.at);
  const { personId } = scope.delegation;
  return admins.includes(personId) ? [personId] : admins.filter((admin) => admin !== personId);
}

function runFailed(scope: RecipientScope): Named {
  const { run, delegationPerson } = scope;
  const held = holderPerson(scope.item?.prior ?? null, delegationPerson);
  if (held !== null || run === null) return [held];
  const delegated = run.delegationId === null ? null : delegationPerson(run.delegationId);
  return [delegated ?? deviceOwnerSegment(run.persona)];
}

function stageAdvanced(scope: RecipientScope): Named {
  const prior = scope.item?.prior ?? null;
  const held = holderPerson(prior, scope.delegationPerson);
  if (held !== null || prior?.gateStatus !== 'parked') return [held];
  return [personBehind(scope.item?.parkedBy ?? null, scope.delegationPerson)];
}

const byReason: ReadonlyMap<WakeReason, (scope: RecipientScope) => Named> = new Map([
  ['gate_waiting', gateWaiting],
  ['delegation_lapsed', delegationLapsed],
  ['run_failed', runFailed],
  ['stage_advanced', stageAdvanced],
]);

function selfOf(actor: string): string | null {
  return actor.startsWith(HUMAN) ? actor.slice(HUMAN.length) : null;
}

export function recipientsOf(scope: RecipientScope): readonly string[] {
  const named = byReason.get(scope.trigger.reason)?.(scope) ?? [];
  const self = selfOf(scope.trigger.event.actor);
  const kept = named.filter(
    (personId): personId is string => personId !== null && personId !== self,
  );
  return [...new Set(kept)].toSorted();
}
