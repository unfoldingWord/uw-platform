import type { Context } from 'hono';
import {
  areaOfCategory,
  createPageCommandSchema,
  jdCategorySchema,
  knowledgeFrontmatterSchema,
} from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { slugFor } from '../../pages/copy.ts';
import { createPage, readPage } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { pageEditPath, wikiPath } from '../parts/paths.ts';

type Typed = { readonly title: string; readonly category: string; readonly parent: string };

const spec = {
  title: pageNames.wikiNew,
  current: wikiPath(),
  code: moduleCodes.pages,
  crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.wikiNew }],
};

function refusalText(reason: string): string {
  if (reason === 'category') return 'Not created: A category is two digits, such as 61.';
  if (reason === 'title') return 'Not created: A page needs a title.';
  return `Not created: ${reasonText(reason)}.`;
}

function NewForm(props: { readonly typed: Typed }) {
  const { typed } = props;
  return (
    <Card title="New page" sub="It opens in edit mode once it is filed">
      <form method="post" action="/wiki/new" class="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <input type="hidden" name="parent" value={typed.parent} />
        <TextField
          name="title"
          label="Title"
          scope="new"
          value={typed.title}
          maxLength={200}
          required
        />
        <TextField
          name="category"
          label="Category"
          scope="new"
          value={typed.category}
          maxLength={2}
          required
          hint="Two digits, such as 61. The page is filed in that category's area."
        />
        <p class="m-0 flex flex-wrap items-center gap-2">
          <button type="submit" class={primaryButton}>
            Create page
          </button>
          <a href={wikiPath()} class={commandButton}>
            Cancel
          </a>
        </p>
      </form>
    </Card>
  );
}

function render(c: Context<AppEnv>, typed: Typed, refused: string | null): Promise<Response> {
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={pageNames.wiki}
        title="New page"
        lede="Name the page and say where it is filed. You write it next."
      />
      <div class="flex flex-col gap-5">
        {refused === null ? null : <Note>{refusalText(refused)}</Note>}
        <NewForm typed={typed} />
      </div>
    </>,
  );
}

async function categoryOfParent(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  parent: string,
): Promise<string | null> {
  const database = c.get('database');
  if (database === null) return null;
  const page = await readPage(database.db, screen.caller.actor, parent, screen.at);
  const filed = knowledgeFrontmatterSchema.safeParse(page?.frontmatter);
  return filed.success ? filed.data.jd_category : null;
}

export async function wikiNewScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const parent = idParam(c.req.query('parent')) ?? '';
  const inherited = parent === '' ? null : await categoryOfParent(c, screen, parent);
  const typed = {
    title: c.req.query('title')?.slice(0, 200) ?? '',
    category: inherited ?? c.req.query('category')?.slice(0, 2) ?? '',
    parent: inherited === null ? '' : parent,
  };
  return render(c, typed, null);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function createFromForm(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const posted = await c.req.parseBody();
  const typed = {
    title: text(posted['title']),
    category: text(posted['category']),
    parent: idParam(text(posted['parent'])) ?? '',
  };
  const category = jdCategorySchema.safeParse(typed.category);
  if (!category.success) return render(c, typed, 'category');
  if (typed.title === '') return render(c, typed, 'title');
  const pageId = crypto.randomUUID();
  const command = createPageCommandSchema.safeParse({
    command: 'create_page',
    requestId: posted['requestId'],
    pageId,
    type: 'knowledge',
    jdArea: areaOfCategory(category.data),
    slug: slugFor(typed.title, pageId),
    title: typed.title,
    parentId: typed.parent === '' ? null : typed.parent,
    frontmatter: { jd_category: category.data },
    bodyMd: '',
    status: 'active',
  });
  if (!command.success) return render(c, typed, 'malformed_command');
  const { actor, traceId } = screen.caller;
  const made = await createPage(database.db, actor, command.data, traceId, screen.at);
  if (!made.ok) return render(c, typed, made.reason);
  return c.redirect(pageEditPath(made.page.id), 303);
}
