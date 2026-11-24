import type { Context } from 'hono';
import { z } from 'zod';
import { cascadeTierSchema, jdAreaSchema } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { cellEntities, type CellEntity, type CellTier } from '../../crosswalk/cells.ts';
import { can } from '@uw/core/acl';
import { cascadeNodes } from '../../crosswalk/nodes.ts';
import { PlaceForm, crosswalkCrumbs, nodeChoices, tierWord } from '../parts/crosswalk-forms.tsx';
import { KeptOutcome } from '../parts/access-forms.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { collectionRowPath, crosswalkCellPath, itemPath, pagePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const empty = 'm-0 px-4 py-3 text-sm text-text-3';
const cellTierSchema = z.union([cascadeTierSchema, z.literal('unplaced')]);
const kindWords = { page: 'Page', task: 'Task', item: 'Item' } as const;

function hrefOf(entity: CellEntity): string {
  if (entity.kind === 'page') return pagePath(entity.id);
  if (entity.kind === 'task') return collectionRowPath('tasks', entity.id);
  return itemPath(entity.harnessId ?? '', entity.id);
}

type Choices = readonly { readonly value: string; readonly label: string }[] | null;

function placedCell(entity: CellEntity, choices: Choices) {
  if (choices === null) return entity.node ?? '';
  return (
    <PlaceForm
      kind={entity.kind}
      entityId={entity.id}
      title={entity.title}
      nodeId={entity.nodeId}
      choices={choices}
    />
  );
}

function EntityTable(props: {
  readonly entities: readonly CellEntity[];
  readonly choices: Choices;
}) {
  if (props.entities.length === 0) return <p class={empty}>Nothing is filed here.</p>;
  const columns = [
    { key: 'title', label: 'Title' },
    { key: 'kind', label: 'Kind' },
    { key: 'node', label: 'Placed under' },
  ];
  const rows = props.entities.map((entity) => ({
    title: (
      <a href={hrefOf(entity)} class={pageLink}>
        {entity.title}
      </a>
    ),
    kind: kindWords[entity.kind],
    node: placedCell(entity, props.choices),
  }));
  return <Table caption="Filed here" columns={columns} rows={rows} bare />;
}

export async function crosswalkCellScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const area = jdAreaSchema.safeParse(c.req.param('area'));
  const tier = cellTierSchema.safeParse(c.req.param('tier'));
  if (!area.success || !tier.success) return notFound(c);
  const shownTier: CellTier = tier.data;
  const { actor } = screen.caller;
  const found = await cellEntities(database.db, actor, area.data, shownTier, screen.at);
  if (found === null) return notFound(c);
  const title = `${areaLabel(area.data)} · ${tierWord(shownTier)}`;
  const writes = can(actor, 'write', { kind: 'area', area: area.data }, screen.at);
  const readable = (await cascadeNodes(database.db)).filter((node) =>
    can(actor, 'read', { kind: 'area', area: node.jdArea }, screen.at),
  );
  const choices = writes ? nodeChoices(readable) : null;
  const spec = {
    title,
    current: crosswalkCellPath(area.data, shownTier),
    code: moduleCodes.crosswalk,
    crumbs: crosswalkCrumbs(title),
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow={pageNames.crosswalk} title={title} />
      <KeptOutcome />
      <Card
        title="Filed here"
        sub={
          writes
            ? 'Up to 200 of each kind. Choose where each sits in the cascade.'
            : 'Up to 200 of each kind'
        }
        flush
      >
        <EntityTable entities={found} choices={choices} />
      </Card>
    </>,
  );
}
