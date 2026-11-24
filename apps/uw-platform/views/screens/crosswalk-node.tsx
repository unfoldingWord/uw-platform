import type { Context } from 'hono';
import { z } from 'zod';
import type { CascadeNodeReply } from '@uw/contracts';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { cascadeNodeView } from '../../crosswalk/read.ts';
import { countWords, crosswalkCrumbs, relationWord, tierWord } from '../parts/crosswalk-forms.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { cellLink } from '../parts/collection-cells.tsx';
import { crosswalkCellPath, crosswalkNodePath, pagePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

function AreaTable(props: { readonly node: CascadeNodeReply }) {
  if (props.node.areas.length === 0) {
    return <EmptyState title="No area you can read relates to this node yet." />;
  }
  const columns = [
    { key: 'area', label: 'Area' },
    { key: 'relations', label: 'Relations' },
    { key: 'placed', label: 'Placed here' },
  ];
  const rows = props.node.areas.map((area) => ({
    area: (
      <a href={crosswalkCellPath(area.jdArea, props.node.tier)} class={cellLink}>
        {areaLabel(area.jdArea)}
      </a>
    ),
    relations: area.links.map((link) => relationWord(link.relation)).join(', '),
    placed: countWords(area.counts),
  }));
  return <Table caption="Areas" columns={columns} rows={rows} />;
}

export async function crosswalkNodeScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const id = z.uuid().safeParse(c.req.param('nodeId'));
  const { actor } = screen.caller;
  const node = id.success ? await cascadeNodeView(database.db, actor, id.data, screen.at) : null;
  if (node === null) return notFound(c);
  const spec = {
    title: node.title,
    current: crosswalkNodePath(node.cascadePageId),
    code: moduleCodes.crosswalk,
    crumbs: crosswalkCrumbs(node.title),
  };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        eyebrow: `${pageNames.crosswalk} · ${tierWord(node.tier)}`,
        title: node.title,
        actions: (
          <ButtonLink href={pagePath(node.cascadePageId)} icon="file-lines">
            {`Open the ${tierWord(node.tier).toLowerCase()} page`}
          </ButtonLink>
        ),
      }}
    >
      <Section title="Areas" sub="Every area it relates to, and what each has placed under it">
        <AreaTable node={node} />
      </Section>
    </ListShape>,
  );
}
