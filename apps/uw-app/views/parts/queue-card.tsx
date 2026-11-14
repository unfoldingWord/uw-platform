import { formatDuration, formatInstant } from '@uw/core/dates';
import type { CostBasis, GateStatus, HarnessEvent } from '@uw/contracts';
import type { BoardCard, CardHost } from '@uw/harness';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField } from '@uw/ui/components/field.tsx';
import { HumanWaitChip } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { KanbanCard, type CardFoot } from '@uw/ui/components/kanban-card.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { costText } from './costs.ts';
import { itemPath, personaPath } from './paths.ts';
import { holderText } from './holder-words.ts';

export type CardViewer = {
  readonly identity: string;
  readonly admin: boolean;
  readonly canClaim: boolean;
  readonly at: Date;
};

const hostWords = new Map<CardHost, string>([
  ['workflow-run', 'Platform'],
  ['external-run', 'Own machine'],
  ['person', 'Person'],
  [null, 'Nobody'],
]);

function basisWords(bases: readonly CostBasis[]): string {
  if (bases.length === 0) return 'No runs yet';
  if (bases.length === 2) return 'Metered and subscription';
  return bases[0] === 'metered' ? 'Metered' : 'Subscription';
}

function riskWords(card: BoardCard): string {
  const { riskTier, riskDomains } = card.item;
  if (riskTier === null) return 'Not derived';
  return `${riskTier} · ${riskDomains.length === 0 ? 'No domains' : riskDomains.join(', ')}`;
}

function metaOf(card: BoardCard, at: Date) {
  const { item } = card;
  const cost = costText(card.cost);
  const lease =
    card.leaseExpiresAt === null
      ? []
      : [{ label: 'Lease', value: `Until ${formatInstant(card.leaseExpiresAt)}` }];
  return [
    {
      label: 'Issue',
      value: item.issue === null ? 'None' : `${item.issue.repo}#${item.issue.number}`,
    },
    {
      label: 'Pull request',
      value:
        item.pullRequest === null ? 'None' : `${item.pullRequest.repo}#${item.pullRequest.number}`,
    },
    { label: 'Holder', value: holderText(card.holder, at) },
    { label: 'Host', value: hostWords.get(card.host) ?? 'Nobody' },
    ...lease,
    { label: 'Risk', value: riskWords(card) },
    { label: 'Cost basis', value: basisWords(card.bases) },
    { label: 'Metered cost', value: cost.metered },
    { label: 'Subscription tokens', value: cost.subscription },
  ];
}

type ItemForm = { readonly harnessId: string; readonly itemId: string };

function OneButton(props: ItemForm & { readonly command: string; readonly label: string }) {
  return (
    <CommandForm harnessId={props.harnessId} command={props.command} itemId={props.itemId}>
      <input type="hidden" name="itemId" value={props.itemId} />
      <button type="submit" class={commandButton}>
        {props.label}
      </button>
    </CommandForm>
  );
}

function holdAction(card: BoardCard, harnessId: string, viewer: CardViewer) {
  const { holder, itemId } = card.item;
  if (holder === null) {
    const closed = card.item.gateStatus === 'parked' || card.item.gateStatus === 'done';
    if (!viewer.canClaim || closed) return null;
    return <OneButton harnessId={harnessId} itemId={itemId} command="claim" label="Claim" />;
  }
  if (holder === viewer.identity || viewer.admin) {
    return <OneButton harnessId={harnessId} itemId={itemId} command="release" label="Release" />;
  }
  return null;
}

function ReorderForm(props: ItemForm & { readonly others: readonly BoardCard[] }) {
  const choices = [
    ...props.others.map((other) => ({ value: other.item.itemId, label: other.item.title })),
    { value: '', label: 'The end of the column' },
  ];
  return (
    <CommandForm harnessId={props.harnessId} command="reorder" itemId={props.itemId}>
      <input type="hidden" name="itemId" value={props.itemId} />
      <SelectField
        name="beforeItemId"
        label="Move before"
        scope={props.itemId}
        choices={choices}
        selected=""
      />
      <button type="submit" class={commandButton}>
        Move
      </button>
    </CommandForm>
  );
}

function PersonaLink(props: { readonly card: BoardCard }) {
  const pageId = props.card.liveRun?.personaPageId ?? null;
  if (pageId === null) return null;
  return (
    <a
      href={personaPath(pageId)}
      class="text-sm text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2"
    >
      See the persona running this item
    </a>
  );
}

const hostIcons = new Map<CardHost, CardFoot['icon']>([
  ['workflow-run', 'cloud'],
  ['external-run', 'laptop'],
  ['person', 'user'],
]);

function footOf(card: BoardCard, at: Date): readonly CardFoot[] {
  const icon = hostIcons.get(card.host);
  const metered = card.cost.meteredMinor + card.cost.computeMinor;
  const lease = card.leaseExpiresAt;
  return [
    ...(icon === undefined ? [] : [{ icon, text: hostWords.get(card.host) ?? 'Nobody' }]),
    ...(metered === 0 ? [] : [{ icon: 'circle-dot' as const, text: costText(card.cost).metered }]),
    ...(lease === null
      ? []
      : [
          {
            icon: 'clock' as const,
            text: `${formatDuration(Math.max(0, lease.getTime() - at.getTime()))} left`,
          },
        ]),
  ];
}

function lastLine(event: HarnessEvent | undefined, at: Date): string | undefined {
  if (event === undefined) return undefined;
  const ago = formatDuration(Math.max(0, at.getTime() - new Date(event.at).getTime()));
  return `${reasonText(event.name)} · ${ago} ago`;
}

function riskLine(card: BoardCard): string {
  const { riskTier, riskDomains } = card.item;
  if (riskTier === null) return 'tier not set';
  return riskDomains.length === 0 ? riskTier : `${riskTier} · ${riskDomains.join(', ')}`;
}

function HolderBadge(props: { readonly card: BoardCard }) {
  const { holder } = props.card;
  if (holder === null || holder.identity === null) return null;
  const agent = holder.kind === 'agent';
  return (
    <span
      title={holder.identity}
      class="grid size-size-4 place-items-center rounded-sm bg-raised text-text-2"
    >
      <Icon
        name={agent ? 'robot' : 'user'}
        size={1}
        label={agent ? 'Held by an agent' : 'Held by a person'}
      />
    </span>
  );
}

const gateWords: Readonly<Record<GateStatus, string>> = {
  working: 'Working',
  parked: 'Waiting on a person',
  checks_failed: 'Checks failed',
  done: 'Done',
};

function Waiting(props: { readonly card: BoardCard; readonly at: Date }) {
  const { card } = props;
  if (card.item.gateStatus !== 'parked') return null;
  const since = card.holder?.since ?? null;
  const waited =
    since === null ? '' : ` · ${formatDuration(Math.max(0, props.at.getTime() - since.getTime()))}`;
  return <HumanWaitChip text={`Waiting${waited}`} />;
}

function Status(props: { readonly card: BoardCard; readonly at: Date }) {
  const { item } = props.card;
  const priority = `Priority ${item.priority}`;
  const parked = item.gateStatus === 'parked';
  return (
    <>
      <Waiting card={props.card} at={props.at} />
      <p data-status="" class="m-0 text-xs text-text-2">
        {parked ? priority : `${gateWords[item.gateStatus]} · ${priority}`}
      </p>
    </>
  );
}

const decisionWords: Readonly<Record<string, string>> = {
  approve: 'approve',
  reject: 'send back',
  take_over: 'take over',
  override: 'override',
};

function refusalText(event: HarnessEvent): string {
  if (event.name === 'ship_refused') {
    return 'The platform refused to ship this item. A person decides.';
  }
  const decision = decisionWords[String(event.evidence['decision'])] ?? 'decide';
  return `${event.actor} tried to ${decision} this item, and the platform refused. A person decides.`;
}

function Refusal(props: { readonly event: HarnessEvent | undefined }) {
  if (props.event === undefined) return null;
  return (
    <p data-refusal="" class="m-0 flex items-start gap-1 text-xs text-text-2">
      <Icon name="lock" size={1} />
      <span>{refusalText(props.event)}</span>
    </p>
  );
}

function numberOf(card: BoardCard): string | undefined {
  const { issue, pullRequest } = card.item;
  const parts = [
    ...(issue === null ? [] : [`#${issue.number}`]),
    ...(pullRequest === null ? [] : [`PR #${pullRequest.number}`]),
  ];
  return parts.length === 0 ? undefined : parts.join(' · ');
}

export function QueueCardView(props: {
  readonly harnessId: string;
  readonly card: BoardCard;
  readonly column: readonly BoardCard[];
  readonly viewer: CardViewer;
  readonly last?: HarnessEvent | undefined;
  readonly refusal?: HarnessEvent | undefined;
}) {
  const { card, harnessId } = props;
  const { at } = props.viewer;
  const { itemId } = card.item;
  const others = props.column.filter((other) => other.item.itemId !== itemId);
  return (
    <KanbanCard
      title={card.item.title}
      href={itemPath(harnessId, itemId)}
      meta={metaOf(card, at)}
      number={numberOf(card)}
      risk={riskLine(card)}
      badge={<HolderBadge card={card} />}
      last={lastLine(props.last, at)}
      status={
        <>
          <Status card={card} at={at} />
          <Refusal event={props.refusal} />
        </>
      }
      foot={footOf(card, at)}
      actions={
        <>
          <PersonaLink card={card} />
          {holdAction(card, harnessId, props.viewer)}
          <details>
            <summary class="cursor-pointer text-xs text-text-3 outline-offset-2 outline-accent-text focus-visible:outline-2">
              Move
            </summary>
            <ReorderForm harnessId={harnessId} itemId={itemId} others={others} />
          </details>
        </>
      }
    />
  );
}
