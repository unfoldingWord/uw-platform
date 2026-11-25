import type { Context } from 'hono';
import {
  areaOfCategory,
  createPageCommandSchema,
  jdCategorySchema,
  jdIdOfTitle,
  knowledgeFrontmatterSchema,
  nextFreeJdId,
  titleWithJdId,
} from '@uw/contracts';
import { TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { RailList, railLink } from '@uw/ui/components/rail-list.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../../deps.ts';
import { editorCssPath, editorPath } from '../../generated/editor.ts';
import { styleNonceFor } from '../../http/security-headers.ts';
import { slugFor } from '../../pages/copy.ts';
import { takenJdIds } from '../../pages/jd-ids.ts';
import { createPage, readPage } from '../../pages/store.ts';
import { TEMPLATE_TAG, templatesFor } from '../../pages/templates.ts';
import { EditBar } from '../parts/edit-bar.tsx';
import { EditorFrame } from '../parts/editor-frame.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { BodyField, EditorStatus, TitleField } from '../parts/page-fields.tsx';
import { JdSuggest, jdRefusalText, numberedAttrs } from '../parts/jd-suggest.tsx';
import { idParam } from '../parts/params.ts';
import { pagePath, wikiNewPath, wikiPath } from '../parts/paths.ts';

type Typed = {
  readonly pageId: string;
  readonly title: string;
  readonly category: string;
  readonly parent: string;
  readonly template: string;
  readonly bodyMd: string;
};
type Template = { readonly id: string; readonly title: string };
type Shown = {
  readonly typed: Typed;
  readonly refused: string | null;
  readonly templates: readonly Template[];
  readonly styleNonce: string;
};

const spec = {
  title: pageNames.wikiNew,
  current: wikiPath(),
  code: moduleCodes.pages,
  crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.wikiNew }],
};

const editorHint =
  'Type / for blocks and [[ to link or embed a page. Pictures and files can be added once the page is saved.';

function refusalText(reason: string, typed: Typed): string {
  if (reason === 'category') return 'Not created: A category is two digits, such as 61.';
  if (reason === 'title') return 'Not created: A page needs a title.';
  const numbering = jdRefusalText(reason, typed.title);
  if (numbering !== null) return `Not created: ${numbering}`;
  return `Not created: ${reasonText(reason)}.`;
}

function cancelOf(typed: Typed): string {
  if (typed.parent !== '') return pagePath(typed.parent);
  const category = jdCategorySchema.safeParse(typed.category);
  return category.success ? wikiPath(category.data) : wikiPath();
}

function startLink(typed: Typed, template: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of [
    ['title', typed.title],
    ['category', typed.category],
    ['parent', typed.parent],
    ['template', template],
  ] as const) {
    if (value !== '') query.set(key, value);
  }
  const asked = query.toString();
  return asked === '' ? wikiNewPath() : `${wikiNewPath()}?${asked}`;
}

function Starts(props: { readonly typed: Typed; readonly templates: readonly Template[] }) {
  if (props.templates.length === 0) return null;
  const starts = [{ id: '', title: 'A blank page' }, ...props.templates];
  return (
    <RailList label="Start from" attrs={{ 'data-templates': '' }}>
      {starts.map((start) => (
        <li>
          <a
            href={startLink(props.typed, start.id)}
            aria-current={start.id === props.typed.template ? 'true' : undefined}
            class={`${railLink} aria-[current=true]:font-semibold aria-[current=true]:text-text`}
          >
            {start.title}
          </a>
        </li>
      ))}
    </RailList>
  );
}

function NewRail(props: { readonly shown: Shown }) {
  const { typed, templates } = props.shown;
  return (
    <>
      <TextField
        name="category"
        label="Category"
        scope="new"
        value={typed.category}
        maxLength={2}
        required
        hint="Two digits, such as 61. The page is filed in that category's area."
      />
      <Starts typed={typed} templates={templates} />
      <p class="m-0 text-sm text-text-3">{editorHint}</p>
    </>
  );
}

function markOf(typed: Typed): string {
  const category = jdCategorySchema.safeParse(typed.category);
  return category.success ? `New page in ${category.data}` : 'New page';
}

function Hidden(props: { readonly typed: Typed }) {
  const { typed } = props;
  return (
    <>
      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
      <input type="hidden" name="pageId" value={typed.pageId} />
      <input type="hidden" name="parent" value={typed.parent} />
      <input type="hidden" name="template" value={typed.template} />
    </>
  );
}

function NewForm(props: { readonly shown: Shown }) {
  const { typed, refused, styleNonce } = props.shown;
  return (
    <form
      method="post"
      action={wikiNewPath()}
      data-page-edit=""
      data-new-page=""
      {...numberedAttrs('')}
      data-unsaved={refused === null ? undefined : ''}
      aria-label="New page"
      class="group/edit"
    >
      <Hidden typed={typed} />
      <DocumentShape
        band={<EditBar read={cancelOf(typed)} drafting={false} />}
        head={{
          eyebrow: markOf(typed),
          title: pageNames.wikiNew,
          titleField: (
            <>
              <TitleField pageId={typed.pageId} title={typed.title} placeholder="Page title" />
              <JdSuggest />
            </>
          ),
        }}
        rail={<NewRail shown={props.shown} />}
        railLabel="Where it is filed"
      >
        {refused === null ? null : <Note>{refusalText(refused, typed)}</Note>}
        <div class="flex min-w-0 flex-col gap-4">
          <EditorFrame pageId={typed.pageId} draft={null} styleNonce={styleNonce} />
          <BodyField pageId={typed.pageId} bodyMd={typed.bodyMd} />
          <EditorStatus />
        </div>
      </DocumentShape>
    </form>
  );
}

async function render(c: Context<AppEnv>, typed: Typed, refused: string | null): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  const templates =
    screen === null || database === null
      ? []
      : await templatesFor(database.db, screen.caller.actor, screen.at);
  const shown = { typed, refused, templates, styleNonce: styleNonceFor(c) };
  return renderScreen(
    c,
    spec,
    <>
      <NewForm shown={shown} />
      <link rel="stylesheet" href={editorCssPath} />
      <script type="module" src={editorPath}></script>
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

type Start = { readonly bodyMd: string; readonly tags: readonly string[] };

async function startOf(db: Database, actor: Principal, template: string, at: Date): Promise<Start> {
  const page = template === '' ? null : await readPage(db, actor, template, at);
  const filed = knowledgeFrontmatterSchema.safeParse(page?.frontmatter);
  if (page === null || !filed.success) return { bodyMd: '', tags: [] };
  return { bodyMd: page.bodyMd, tags: filed.data.tags.filter((tag) => tag !== TEMPLATE_TAG) };
}

type Asked = { readonly title: string; readonly category: string; readonly template: string };

function askedOf(c: Context<AppEnv>): Asked {
  return {
    title: c.req.query('title')?.slice(0, 200) ?? '',
    category: c.req.query('category')?.slice(0, 2) ?? '',
    template: idParam(c.req.query('template')) ?? '',
  };
}

async function numbered(db: Database, title: string, category: string): Promise<string> {
  const filed = jdCategorySchema.safeParse(category);
  if (!filed.success || jdIdOfTitle(title) !== null) return title;
  const next = nextFreeJdId(filed.data, await takenJdIds(db, filed.data));
  return next === null ? title : titleWithJdId(title, next);
}

export async function wikiNewScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const asked = askedOf(c);
  const parent = idParam(c.req.query('parent')) ?? '';
  const inherited = parent === '' ? null : await categoryOfParent(c, screen, parent);
  const start = await startOf(database.db, screen.caller.actor, asked.template, screen.at);
  const category = inherited ?? asked.category;
  const typed = {
    ...asked,
    pageId: crypto.randomUUID(),
    title: await numbered(database.db, asked.title, category),
    category,
    parent: inherited === null ? '' : parent,
    bodyMd: start.bodyMd,
  };
  return render(c, typed, null);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function typedFrom(posted: Record<string, unknown>): Typed {
  const body = posted['bodyMd'];
  return {
    pageId: idParam(text(posted['pageId'])) ?? crypto.randomUUID(),
    title: text(posted['title']),
    category: text(posted['category']),
    parent: idParam(text(posted['parent'])) ?? '',
    template: idParam(text(posted['template'])) ?? '',
    bodyMd: typeof body === 'string' ? body : '',
  };
}

async function clashOf(db: Database, number: string, category: string): Promise<string | null> {
  return (await takenJdIds(db, category)).has(number) ? 'jd_taken' : null;
}

function filedByNumber(typed: Typed): Typed {
  const category = jdIdOfTitle(typed.title)?.slice(0, 2);
  if (category === undefined || category === typed.category) return typed;
  return { ...typed, category, parent: '' };
}

export async function createFromForm(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const posted = await c.req.parseBody();
  const typed = filedByNumber(typedFrom(posted));
  const category = jdCategorySchema.safeParse(typed.category);
  if (!category.success) return render(c, typed, 'category');
  if (typed.title === '') return render(c, typed, 'title');
  const number = jdIdOfTitle(typed.title);
  const clash = number === null ? null : await clashOf(database.db, number, category.data);
  if (clash !== null) return render(c, typed, clash);
  const { actor, traceId } = screen.caller;
  const start = await startOf(database.db, actor, typed.template, screen.at);
  const command = createPageCommandSchema.safeParse({
    command: 'create_page',
    requestId: posted['requestId'],
    pageId: typed.pageId,
    type: 'knowledge',
    jdArea: areaOfCategory(category.data),
    slug: slugFor(typed.title, typed.pageId),
    title: typed.title,
    parentId: typed.parent === '' ? null : typed.parent,
    frontmatter: { jd_category: category.data, jd_id: number, tags: start.tags },
    bodyMd: typed.bodyMd,
    status: 'active',
  });
  if (!command.success) return render(c, typed, 'malformed_command');
  const made = await createPage(database.db, actor, command.data, traceId, screen.at);
  if (!made.ok) return render(c, typed, made.reason);
  return c.redirect(`${pagePath(made.page.id)}?saved=${String(made.page.version)}`, 303);
}
