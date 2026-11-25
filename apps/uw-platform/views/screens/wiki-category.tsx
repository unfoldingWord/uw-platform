import type { Context } from 'hono';
import { areaOfCategory, jdCategorySchema, type JdCategory } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { Button, ButtonLink } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryName, pagesInCategory } from '../../pages/categories.ts';
import { treeOf, type TreeNode } from '../../pages/tree.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { wikiBranch } from '../parts/wiki-tree.ts';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pagePath, wikiNewPath, wikiPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { countWords } from './wiki.tsx';

const PAGES_ENDPOINT = '/api/pages/commands';

const treeLink =
  'text-base font-semibold text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

function Branch(props: { readonly nodes: readonly TreeNode[]; readonly top: boolean }) {
  const tree = props.top ? { 'data-tree': '' } : {};
  return (
    <ul
      class={`m-0 flex list-none flex-col gap-2 p-0 ${props.top ? '' : 'mt-2 border-l border-line-soft pl-4'}`}
      {...tree}
    >
      {props.nodes.map((node) => (
        <li>
          <a href={pagePath(node.page.id)} class={treeLink}>
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
    <Section title="Name this category" sub="Shown beside its number everywhere">
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
        <Button type="submit" variant="human">
          Save name
        </Button>
      </PlatformCommandForm>
    </Section>
  );
}

function categorySpec(category: string, title: string) {
  return {
    title,
    current: wikiPath(category),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: title }],
  };
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
  const branch = await wikiBranch(database.db, actor, screen.at, { category, pages: entries });
  const spec = { ...categorySpec(category, title), branch };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        eyebrow: areaLabel(area),
        title,
        lede: `${countWords(entries.length)} filed in this category.`,
        actions: can(actor, 'write', { kind: 'area', area }, screen.at) ? (
          <ButtonLink href={wikiNewPath({ category })} variant="primary" icon="pen">
            New page in this category
          </ButtonLink>
        ) : undefined,
      }}
    >
      <Section title="Pages">
        {entries.length === 0 ? (
          <EmptyState title="No pages yet" text="No page is filed here yet." />
        ) : (
          <Branch nodes={treeOf(entries)} top />
        )}
      </Section>
      {can(actor, 'admin', { kind: 'area', area }, screen.at) ? (
        <NameForm category={category} name={name} />
      ) : null}
    </ListShape>,
  );
}
