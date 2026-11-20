import type { Context } from 'hono';
import { areaOfCategory, jdCategorySchema, type JdCategory } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Card } from '@uw/ui/components/card.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryName, pagesInCategory } from '../../pages/categories.ts';
import { treeOf, type TreeNode } from '../../pages/tree.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { pagePath, wikiNewPath, wikiPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { countWords } from './wiki.tsx';

const PAGES_ENDPOINT = '/api/pages/commands';

function Branch(props: { readonly nodes: readonly TreeNode[]; readonly top: boolean }) {
  const tree = props.top ? { 'data-tree': '' } : {};
  return (
    <ul class={`m-0 flex list-none flex-col gap-1 p-0 ${props.top ? '' : 'mt-1 pl-5'}`} {...tree}>
      {props.nodes.map((node) => (
        <li>
          <a href={pagePath(node.page.id)} class={pageLink}>
            {node.page.title}
          </a>
          {node.children.length === 0 ? null : <Branch nodes={node.children} top={false} />}
        </li>
      ))}
    </ul>
  );
}

function NameForm(props: { readonly category: JdCategory; readonly name: string | null }) {
  return (
    <Card title="Name this category" sub="Shown beside its number everywhere">
      <PlatformCommandForm
        endpoint={PAGES_ENDPOINT}
        command="name_category"
        scope={props.category}
        done="Saved. Reload to see the new name."
      >
        <input type="hidden" name="category" value={props.category} />
        <TextField
          name="name"
          label="Name"
          scope={props.category}
          value={props.name ?? ''}
          maxLength={80}
          required
        />
        <button type="submit" class={commandButton}>
          Save name
        </button>
      </PlatformCommandForm>
    </Card>
  );
}

export async function wikiCategoryScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const parsed = jdCategorySchema.safeParse(c.req.param('category'));
  if (!parsed.success) return notFound(c);
  const category = parsed.data;
  const { actor } = screen.caller;
  const entries = await pagesInCategory(database.db, actor, category, screen.at);
  if (entries === null) return notFound(c);
  const name = await categoryName(database.db, category);
  const area = areaOfCategory(category);
  const title = name === null ? category : `${category} ${name}`;
  const spec = {
    title,
    current: wikiPath(),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: title }],
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={areaLabel(area)}
        title={title}
        lede={`${countWords(entries.length)} filed in this category.`}
      />
      <div class="flex flex-col gap-5">
        {can(actor, 'write', { kind: 'area', area }, screen.at) ? (
          <p class="m-0">
            <a href={wikiNewPath({ category })} class={pageLink}>
              New page in this category
            </a>
          </p>
        ) : null}
        <Card title="Pages">
          {entries.length === 0 ? (
            <p class="m-0 text-sm text-text-2">No page is filed here yet.</p>
          ) : (
            <Branch nodes={treeOf(entries)} top />
          )}
        </Card>
        {can(actor, 'admin', { kind: 'area', area }, screen.at) ? (
          <NameForm category={category} name={name} />
        ) : null}
      </div>
    </>,
  );
}
