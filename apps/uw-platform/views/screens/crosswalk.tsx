import type { Context } from 'hono';
import type { CrosswalkCell, CrosswalkReply, EntityCounts } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { cascadeNodes } from '../../crosswalk/nodes.ts';
import { crosswalk, mapLinks, type AreaLink } from '../../crosswalk/read.ts';
import { decades } from '../../crosswalk/scope.ts';
import { KeptOutcome } from '../parts/access-forms.tsx';
import {
  DeclareForm,
  RemoveForm,
  countWords,
  relationWord,
  tierWord,
} from '../parts/crosswalk-forms.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { cellLink } from '../parts/collection-cells.tsx';
import {
  collectionPath,
  crosswalkCellPath,
  crosswalkNodePath,
  crosswalkPath,
  wikiAreaPath,
} from '../parts/paths.ts';

const quiet = 'text-xs text-text-3';

const lede =
  'Johnny.Decimal says where a thing is filed. The Strategic Cascade says why it exists. Each row is an area, each column a cascade tier: a cell counts the pages, tasks and items filed in that area and placed at that tier, and lists how the area relates to that tier’s nodes. Only areas you can read are shown.';

function Links(props: { readonly cell: CrosswalkCell }) {
  if (props.cell.links.length === 0) return null;
  return (
    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      {props.cell.links.map((link) => (
        <li class="text-xs">
          <span class="text-text-3">{relationWord(link.relation)} </span>
          <a href={crosswalkNodePath(link.cascadePageId)} class={cellLink}>
            {link.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Cell(props: {
  readonly area: string;
  readonly tier: string;
  readonly counts: EntityCounts;
  readonly cell?: CrosswalkCell;
}) {
  const words = countWords(props.counts);
  return (
    <span class="flex min-w-0 flex-col gap-1" data-cell={`${props.area} ${props.tier}`}>
      {words === 'None' ? (
        <span class={quiet}>None</span>
      ) : (
        <a href={crosswalkCellPath(props.area, props.tier)} class={cellLink}>
          {words}
        </a>
      )}
      {props.cell === undefined ? null : <Links cell={props.cell} />}
    </span>
  );
}

function columnsOf(reply: CrosswalkReply) {
  return [
    { key: 'area', label: 'Area' },
    ...reply.tiers.map((tier) => ({ key: tier, label: tierWord(tier) })),
    { key: 'unplaced', label: tierWord('unplaced') },
  ];
}

function rowsOf(reply: CrosswalkReply) {
  return reply.rows.map((row) => ({
    area: (
      <a href={wikiAreaPath(row.jdArea)} class={cellLink}>
        {areaLabel(row.jdArea)}
      </a>
    ),
    ...Object.fromEntries(
      row.cells.map((cell) => [
        cell.tier,
        <Cell area={row.jdArea} tier={cell.tier} counts={cell.counts} cell={cell} />,
      ]),
    ),
    unplaced: <Cell area={row.jdArea} tier="unplaced" counts={row.unplaced} />,
  }));
}

function TierLinks(props: { readonly reply: CrosswalkReply }) {
  return (
    <>
      {props.reply.tiers.map((tier) => (
        <ButtonLink href={collectionPath(tier)} variant="ghost" size="sm">
          {`Every ${tierWord(tier).toLowerCase()}`}
        </ButtonLink>
      ))}
    </>
  );
}

function MapTable(props: { readonly links: readonly AreaLink[] }) {
  if (props.links.length === 0) return <EmptyState title="No relation is declared yet." />;
  const columns = [
    { key: 'area', label: 'Area' },
    { key: 'relation', label: 'Relation' },
    { key: 'node', label: 'Cascade node' },
    { key: 'note', label: 'Note' },
    { key: 'remove', label: 'Remove' },
  ];
  const rows = props.links.map((link) => ({
    area: areaLabel(link.jdArea),
    relation: relationWord(link.relation),
    node: (
      <a href={crosswalkNodePath(link.cascadePageId)} class={cellLink}>
        {`${tierWord(link.tier)} · ${link.title}`}
      </a>
    ),
    note: link.note ?? '',
    remove: (
      <RemoveForm
        mapId={link.mapId}
        what={`${areaLabel(link.jdArea)} ${relationWord(link.relation).toLowerCase()} ${link.title}`}
      />
    ),
  }));
  return <Table caption="JD map" columns={columns} rows={rows} />;
}

async function AdminPanel(props: { readonly c: Context<AppEnv>; readonly at: Date }) {
  const database = props.c.get('database');
  const actor = props.c.get('principal');
  if (database === null || actor === null) return null;
  const [nodes, links] = await Promise.all([
    cascadeNodes(database.db),
    mapLinks(database.db, actor, props.at),
  ]);
  return (
    <>
      <Section title="Declare a relation" sub="Org admins only. Every change is audited.">
        <DeclareForm areas={decades} nodes={nodes} />
      </Section>
      <Section title="JD map" sub="Every declared relation">
        <MapTable links={links} />
      </Section>
    </>
  );
}

export async function crosswalkScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const { actor } = screen.caller;
  const reply = await crosswalk(database.db, actor, screen.at);
  const admin = can(actor, 'admin', { kind: 'org' }, screen.at);
  const spec = {
    title: pageNames.crosswalk,
    current: crosswalkPath(),
    code: moduleCodes.crosswalk,
    crumbs: [{ label: 'unfoldingWord Home' }, { label: pageNames.crosswalk }],
  };
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.crosswalk, lede }}>
      <KeptOutcome />
      <Section title="Areas and the cascade" actions={<TierLinks reply={reply} />}>
        {reply.rows.length === 0 ? (
          <EmptyState
            title="You can read no area yet."
            text="Areas you hold a grant on will appear here."
          />
        ) : (
          <Table caption="JD crosswalk" columns={columnsOf(reply)} rows={rowsOf(reply)} />
        )}
      </Section>
      {admin ? await AdminPanel({ c, at: screen.at }) : null}
    </ListShape>,
  );
}
