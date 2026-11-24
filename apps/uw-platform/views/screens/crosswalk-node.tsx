import type { Context } from 'hono';
import { z } from 'zod';
import type { CascadeNodeReply } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { cascadeNodeView } from '../../crosswalk/read.ts';
import { countWords, crosswalkCrumbs, relationWord, tierWord } from '../parts/crosswalk-forms.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { crosswalkCellPath, crosswalkNodePath, pagePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const empty = 'm-0 px-4 py-3 text-sm text-text-3';

function AreaTable(props: { readonly node: CascadeNodeReply }) {
  if (props.node.areas.length === 0) {
    return <p class={empty}>No area you can read relates to this node yet.</p>;
  }
  const columns = [
    { key: 'area', label: 'Area' },
    { key: 'relations', label: 'Relations' },
    { key: 'placed', label: 'Placed here' },
  ];
  const rows = props.node.areas.map((area) => ({
    area: (
      <a href={crosswalkCellPath(area.jdArea, props.node.tier)} class={pageLink}>
        {areaLabel(area.jdArea)}
      </a>
    ),
    relations: area.links.map((link) => relationWord(link.relation)).join(', '),
    placed: countWords(area.counts),
  }));
  return <Table caption="Areas" columns={columns} rows={rows} bare />;
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
    <>
      <PageHead eyebrow={`${pageNames.crosswalk} · ${tierWord(node.tier)}`} title={node.title} />
      <div class="flex flex-col gap-3">
        <p class="m-0 text-sm">
          <a href={pagePath(node.cascadePageId)} class={pageLink}>
            Open the {tierWord(node.tier).toLowerCase()} page
          </a>
        </p>
        <Card title="Areas" sub="Every area it relates to, and what each has placed under it" flush>
          <AreaTable node={node} />
        </Card>
      </div>
    </>,
  );
}
