import {
  assistantIdentityOf,
  harnessSchema,
  type AssistantAccountStatus,
  type AssistantPairingVia,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Harness } from '@uw/contracts';
import type {
  AssistantAccountRow,
  AssistantSettingsRow,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { readOnly } from '../store-read.ts';
import { requestsOf, settlingEvents, type Live, type OverviewRequest } from './overview-effects.ts';
import { monthlyMinorOf } from './pool.ts';
import { assistantRole } from './role.ts';
import { spendThisMonth, spentMicros } from './spend.ts';

export type { OverviewEffect, OverviewRequest } from './overview-effects.ts';

export type OverviewInput = { readonly personId: string | null };
export type AssistantOverview = {
  readonly self: boolean;
  readonly personId: string;
  readonly harnessId: string | null;
  readonly title: string | null;
  readonly account: {
    readonly name: string;
    readonly jdId: string | null;
    readonly status: AssistantAccountStatus;
    readonly disabledAt: Date | null;
  } | null;
  readonly settings: AssistantSettingsRow | null;
  readonly assist: { readonly delegationId: string; readonly expiresAt: Date } | null;
  readonly budget: {
    readonly monthlyMinor: number;
    readonly overridden: boolean;
    readonly spentMinor: number;
  };
  readonly paired: { readonly via: AssistantPairingVia; readonly boundAt: Date } | null;
  readonly requests: readonly OverviewRequest[];
  readonly reminders: readonly {
    readonly effectId: string;
    readonly text: string;
    readonly dueAt: Date;
  }[];
  readonly holds: readonly {
    readonly effectId: string;
    readonly title: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
  }[];
};

type OverviewPorts = Pick<Ports, 'clock' | 'store'>;
type Viewer = { readonly personId: string; readonly self: boolean };

const REQUESTS_SHOWN = 15;
const LIVE_MOST = 200;
const MICROS_PER_MINOR = 10_000;

function viewerOf(caller: Caller, input: OverviewInput, at: Date): Viewer | Refused {
  const { actor } = caller;
  const denied = refused('not_permitted', { actor: actor.identity });
  if (isAgent(actor) || !actor.interactive || actor.personId === null) return denied;
  const personId = input.personId ?? actor.personId;
  if (!harnessSchema.shape.id.safeParse(personId).success) {
    return refused('malformed_command', { field: 'personId' });
  }
  if (personId === actor.personId) return { personId, self: true };
  return can(actor, 'admin', { kind: 'org' }, at) ? { personId, self: false } : denied;
}

async function budgetOf(tx: StoreTransaction, harnessId: string | null, at: Date) {
  const fallback = assistantRole.budget.monthly_minor;
  if (harnessId === null) return { monthlyMinor: fallback, overridden: false, spentMinor: 0 };
  const spend = await spendThisMonth(tx, harnessId, at);
  return {
    monthlyMinor: await monthlyMinorOf(tx, harnessId, fallback),
    overridden: (await tx.assistantBudgets.read.of(harnessId)) !== null,
    spentMinor: Math.ceil(spentMicros(spend, assistantRole.turnCeilingMinor) / MICROS_PER_MINOR),
  };
}

async function assistOf(tx: StoreTransaction, harness: Harness, personId: string, at: Date) {
  const filter = { personId, persona: assistantIdentityOf(personId), harnessId: harness.id };
  const live = await tx.delegations.read.live(filter, at);
  const found = live.find((delegation) => delegation.capability === 'assist');
  return found === undefined ? null : { delegationId: found.id, expiresAt: found.expiresAt };
}

async function contentOf(tx: StoreTransaction, harnessId: string, at: Date) {
  const live: Live = {
    reminders: await tx.assistantReminders.read.pending(harnessId, LIVE_MOST),
    holds: await tx.assistantHolds.read.held(harnessId, LIVE_MOST),
    at,
  };
  const recent = await tx.assistantRequests.read.recent(harnessId, REQUESTS_SHOWN);
  const effects = await tx.assistantEffects.read.forRequests(recent.map((request) => request.id));
  const oldest = recent.at(-1)?.recordedAt ?? at;
  const events = await settlingEvents(tx, harnessId, oldest);
  return {
    settings: await tx.assistantSettings.read.byHarness(harnessId),
    requests: requestsOf(recent, effects, events, live),
    reminders: live.reminders.map((row) => ({
      effectId: row.effectId,
      text: row.text,
      dueAt: row.dueAt,
    })),
    holds: live.holds.map((row) => ({
      effectId: row.id,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
  };
}

const noContent = { settings: null, requests: [], reminders: [], holds: [] };

function accountOf(account: AssistantAccountRow | null): AssistantOverview['account'] {
  if (account === null) return null;
  const { name, jdId, status, disabledAt } = account;
  return { name, jdId, status, disabledAt };
}

async function pairedOf(tx: StoreTransaction, harness: Harness | null) {
  if (harness === null) return null;
  const binding = await tx.assistantBindings.read.of(harness.id, 'zulip_dm');
  return binding === null ? null : { via: binding.via, boundAt: binding.boundAt };
}

async function overviewIn(tx: StoreTransaction, viewer: Viewer, at: Date) {
  const harness = await tx.harnesses.read.byPerson(viewer.personId);
  const harnessId = harness?.id ?? null;
  const content =
    harnessId === null || !viewer.self ? noContent : await contentOf(tx, harnessId, at);
  const overview: AssistantOverview = {
    self: viewer.self,
    personId: viewer.personId,
    harnessId,
    title: harness?.title ?? null,
    account: accountOf(await tx.assistantAccounts.read.byPerson(viewer.personId)),
    assist: harness === null ? null : await assistOf(tx, harness, viewer.personId, at),
    budget: await budgetOf(tx, harnessId, at),
    paired: await pairedOf(tx, harness),
    ...content,
  };
  return overview;
}

export async function overview(
  ports: OverviewPorts,
  caller: Caller,
  input: OverviewInput,
): Promise<KernelOutcome<AssistantOverview>> {
  const at = ports.clock.now();
  const viewer = viewerOf(caller, input, at);
  if ('status' in viewer) return viewer;
  return accepted(await readOnly(ports.store, (tx) => overviewIn(tx, viewer, at)));
}
