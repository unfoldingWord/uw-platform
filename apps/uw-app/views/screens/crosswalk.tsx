import type { Context } from 'hono';
import type { CrosswalkCell, CrosswalkReply, EntityCounts } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
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
import { pageLink } from '../parts/page-shown.ts';
import {
  collectionPath,
  crosswalkCellPath,
  crosswalkNodePath,
  crosswalkPath,
  wikiAreaPath,
} from '../parts/paths.ts';

const empty = 'm-0 px-4 py-3 text-sm text-text-3';
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
          <a href={crosswalkNodePath(link.cascadePageId)} class={pageLink}>
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
        <a href={crosswalkCellPath(props.area, props.tier)} class={pageLink}>
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
      <a href={wikiAreaPath(row.jdArea)} class={pageLink}>
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
    <p class="m-0 flex flex-wrap gap-4 text-sm">
      {props.reply.tiers.map((tier) => (
        <a href={collectionPath(tier)} class={pageLink}>
          Every {tierWord(tier).toLowerCase()}
        </a>
      ))}
    </p>
  );
}

function MapTable(props: { readonly links: readonly AreaLink[] }) {
  if (props.links.length === 0) return <p class={empty}>No relation is declared yet.</p>;
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
      <a href={crosswalkNodePath(link.cascadePageId)} class={pageLink}>
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
  return <Table caption="JD map" columns={columns} rows={rows} bare />;
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
      <Card title="Declare a relation" sub="Org admins only. Every change is audited.">
        <DeclareForm areas={decades} nodes={nodes} />
      </Card>
      <Card title="JD map" sub="Every declared relation" flush>
        <MapTable links={links} />
      </Card>
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
    <>
      <PageHead title={pageNames.crosswalk} lede={lede} />
      <KeptOutcome />
      <div class="flex flex-col gap-5">
        <Card title="Areas and the cascade" sub={<TierLinks reply={reply} />} flush>
          {reply.rows.length === 0 ? (
            <p class={empty}>You can read no area yet.</p>
          ) : (
            <Table caption="JD crosswalk" columns={columnsOf(reply)} rows={rowsOf(reply)} bare />
          )}
        </Card>
        {admin ? await AdminPanel({ c, at: screen.at }) : null}
      </div>
    </>,
  );
}
