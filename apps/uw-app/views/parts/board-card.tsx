import { formatInstant } from '@uw/core/dates';
import type { CostBasis } from '@uw/contracts';
import type { BoardCard, CardHost } from '@uw/harness';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField } from '@uw/ui/components/field.tsx';
import { KanbanCard } from '@uw/ui/components/kanban-card.tsx';
import { costText } from './costs.ts';
import { itemPath, personaPath } from './paths.ts';
import { holderText } from './holder-words.ts';

export type CardViewer = {
  readonly identity: string;
  readonly admin: boolean;
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
      class="text-sm text-link underline outline-offset-2 outline-focus focus-visible:outline-2"
    >
      See the persona running this item
    </a>
  );
}

export function BoardCardView(props: {
  readonly harnessId: string;
  readonly card: BoardCard;
  readonly column: readonly BoardCard[];
  readonly viewer: CardViewer;
}) {
  const { card, harnessId } = props;
  const { itemId } = card.item;
  const others = props.column.filter((other) => other.item.itemId !== itemId);
  return (
    <KanbanCard
      title={card.item.title}
      href={itemPath(harnessId, itemId)}
      meta={metaOf(card, props.viewer.at)}
      actions={
        <>
          <PersonaLink card={card} />
          {holdAction(card, harnessId, props.viewer)}
          <ReorderForm harnessId={harnessId} itemId={itemId} others={others} />
        </>
      }
    />
  );
}
