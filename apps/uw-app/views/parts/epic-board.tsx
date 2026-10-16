import type { EpicGroup, EpicNode, NotReady } from '@uw/harness';
import { domId } from '@uw/ui/components/text.ts';
import { epicLayout, NODE_HEIGHT, NODE_WIDTH, type EpicLayout } from './epic-layout.ts';
import { issueUrl, itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const viaWords: Readonly<Record<NotReady['via'], string>> = {
  import: 'Refused at import',
  kickstart: 'Refused at kickstart',
  enqueue_epic: 'Refused when its epic was enqueued',
};

function nameOf(node: EpicNode): string {
  return node.issue === null ? node.title : `#${node.issue.number}`;
}

function waitsOn(node: EpicNode, group: EpicGroup): string {
  const names = node.blockedBy.flatMap((id) => {
    const blocker = group.nodes.find((other) => other.itemId === id);
    return blocker === undefined ? [] : [nameOf(blocker)];
  });
  return names.length === 0 ? '' : `, waits on ${names.join(' and ')}`;
}

function stateWords(node: EpicNode): string {
  if (node.passedShip) return `${node.stageKey}, past Ship`;
  return node.waiting ? `${node.stageKey}, waiting` : node.stageKey;
}

function nodeClass(node: EpicNode): string {
  if (node.passedShip) return 'fill-bg stroke-line';
  return node.waiting ? 'fill-bg stroke-ocean' : 'fill-surface stroke-ocean';
}

function Arrowhead(props: { readonly id: string }) {
  return (
    <defs>
      <marker
        id={props.id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="8"
        markerHeight="8"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" class="fill-ocean" />
      </marker>
    </defs>
  );
}

type Placed = { readonly x: number; readonly y: number };

function Node(props: {
  readonly harnessId: string;
  readonly group: EpicGroup;
  readonly node: EpicNode;
  readonly at: Placed;
}) {
  const { node, at } = props;
  return (
    <a
      href={itemPath(props.harnessId, node.itemId)}
      aria-label={`${nameOf(node)} ${node.title}, ${stateWords(node)}${waitsOn(node, props.group)}`}
      class={focus}
    >
      <rect
        x={at.x}
        y={at.y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx="8"
        stroke-width="2"
        stroke-dasharray={node.waiting ? '6 4' : undefined}
        class={nodeClass(node)}
      />
      <text x={at.x + 12} y={at.y + 22} class="fill-ink text-xs font-bold">
        {nameOf(node)}
      </text>
      <text x={at.x + 12} y={at.y + 42} class="fill-muted text-xs">
        {stateWords(node)}
      </text>
    </a>
  );
}

function Drawing(props: {
  readonly harnessId: string;
  readonly group: EpicGroup;
  readonly laid: EpicLayout;
}) {
  const { group, laid } = props;
  const key = String(group.epic.githubId);
  const arrow = domId('epic', key, 'arrow');
  const titleId = domId('epic', key, 'title');
  const descId = domId('epic', key, 'desc');
  const byId = new Map(group.nodes.map((node) => [node.itemId, node]));
  return (
    <div class="overflow-x-auto rounded-lg border border-line bg-surface p-2">
      <svg
        role="group"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={`0 0 ${laid.width} ${laid.height}`}
        class="h-auto w-full"
      >
        <title id={titleId}>{`#${group.epic.number} ${group.title} as items and blockers`}</title>
        <desc id={descId}>
          {`${group.nodes.length} items; an arrow runs from a blocker to the item that waits on it`}
        </desc>
        <Arrowhead id={arrow} />
        {laid.edges.map((edge) => (
          <line
            data-edge={`${edge.from} ${edge.to}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke-width="2"
            class="stroke-ocean"
            marker-end={`url(#${arrow})`}
          />
        ))}
        {laid.nodes.map((at) => {
          const node = byId.get(at.itemId);
          return node === undefined ? null : (
            <Node harnessId={props.harnessId} group={group} node={node} at={at} />
          );
        })}
      </svg>
    </div>
  );
}

function Group(props: { readonly harnessId: string; readonly group: EpicGroup }) {
  const { group } = props;
  const headingId = domId('epic', String(group.epic.githubId), 'heading');
  return (
    <section
      data-epic={String(group.epic.number)}
      aria-labelledby={headingId}
      class="mb-4 rounded-lg border border-line bg-surface p-4"
    >
      <h3 id={headingId} class="mb-2 font-bold text-ink">
        {`#${group.epic.number} ${group.title}`}
      </h3>
      <Drawing harnessId={props.harnessId} group={group} laid={epicLayout(group)} />
      <ol class="mt-2 list-decimal pl-6 text-sm text-ink">
        {group.nodes.map((node) => (
          <li>
            <a href={itemPath(props.harnessId, node.itemId)} class={`text-link underline ${focus}`}>
              {`${nameOf(node)} ${node.title}`}
            </a>
            {`, ${stateWords(node)}${waitsOn(node, group)}`}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EpicGroups(props: {
  readonly harnessId: string;
  readonly epics: readonly EpicGroup[];
}) {
  if (props.epics.length === 0) return null;
  const headingId = domId('board', props.harnessId, 'epics');
  return (
    <section aria-labelledby={headingId} class="mb-6">
      <h2 id={headingId} class="mb-2 text-lg font-bold text-ink">
        Epics
      </h2>
      {props.epics.map((group) => (
        <Group harnessId={props.harnessId} group={group} />
      ))}
    </section>
  );
}

function NotReadyEntry(props: { readonly entry: NotReady }) {
  const { entry } = props;
  return (
    <li>
      {entry.issue === null ? (
        entry.title
      ) : (
        <a href={issueUrl(entry.issue)} class={`text-link underline ${focus}`}>
          {`#${entry.issue.number} ${entry.title}`}
        </a>
      )}
      {`. ${viaWords[entry.via]}.`}
    </li>
  );
}

export function NotReadyList(props: {
  readonly harnessId: string;
  readonly entries: readonly NotReady[];
}) {
  if (props.entries.length === 0) return null;
  const headingId = domId('board', props.harnessId, 'not-ready');
  return (
    <section aria-labelledby={headingId} class="mb-6 rounded-lg border border-line bg-surface p-4">
      <h2 id={headingId} class="mb-1 text-lg font-bold text-ink">
        Not ready
      </h2>
      <p class="mb-2 text-sm text-muted">
        These have no Done when heading, so intake refused them. Add a Done when heading with at
        least one line under it, then try again.
      </p>
      <ul class="list-disc pl-6 text-sm text-ink">
        {props.entries.map((entry) => (
          <NotReadyEntry entry={entry} />
        ))}
      </ul>
    </section>
  );
}
