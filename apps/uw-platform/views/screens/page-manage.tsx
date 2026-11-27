import type { Context } from 'hono';
import {
  knowledgeFrontmatterSchema,
  movePageCommandSchema,
  updatePageCommandSchema,
  type Page,
  type PageEntry,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Hairline, Section } from '@uw/ui/components/section.tsx';
import { FormActions, FormShape } from '@uw/ui/shapes/form.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { Child } from 'hono/jsx';
import type { AppEnv } from '../../deps.ts';
import { pagesInCategory } from '../../pages/categories.ts';
import { copyPage } from '../../pages/copy.ts';
import { movePage } from '../../pages/move.ts';
import { measurePauses } from '../../measures/activations.ts';
import { updatePageWith, type PageRefusal, type PageResult } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { pageLink, pageScreenSpec, shownPage, type ShownPage } from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pageEditPath, pageManagePath, pagePath, wikiAreaPath } from '../parts/paths.ts';
import { AreaHomeCard, changeAreaHome, homeStateOf } from '../parts/area-home-card.tsx';
import { notFound } from './not-found.tsx';

type Managed = {
  readonly screen: ScreenKernel;
  readonly shown: ShownPage;
  readonly category: string;
};
type Found = { readonly screen: ScreenKernel; readonly shown: ShownPage };
type Posted = Readonly<Record<string, unknown>>;
type Outcome = PageResult | PageRefusal;

const TOP = '';

function Action(props: { readonly page: Page; readonly intent: string; readonly children: Child }) {
  return (
    <form method="post" action={pageManagePath(props.page.id)} class="flex flex-col gap-4">
      <input type="hidden" name="intent" value={props.intent} />
      <input type="hidden" name="expectedVersion" value={String(props.page.version)} />
      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
      {props.children}
    </form>
  );
}

function MoveCard(props: { readonly managed: Managed; readonly siblings: readonly PageEntry[] }) {
  const { page } = props.managed.shown;
  const choices = [
    { value: TOP, label: 'Top of the category' },
    ...props.siblings
      .filter((entry) => entry.id !== page.id)
      .map((entry) => ({ value: entry.id, label: entry.title })),
  ];
  return (
    <Section title="Move" sub="Links to this page keep working">
      <Action page={page} intent="move">
        <TextField
          name="category"
          label="Category"
          scope={page.id}
          value={props.managed.category}
          maxLength={2}
          required
          hint="Two digits. A new category puts the page at the top of it, and its JD ID is cleared."
        />
        <SelectField
          name="parent"
          label="Under"
          scope={page.id}
          choices={choices}
          selected={page.parentId ?? TOP}
        />
        <FormActions>
          <Button type="submit">Move page</Button>
        </FormActions>
      </Action>
    </Section>
  );
}

const periods = [
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
];

function VerifyCard(props: { readonly page: Page }) {
  return (
    <Section title="Verify" sub="Says you read this page and it is still right">
      <Action page={props.page} intent="verify">
        <SelectField
          name="days"
          label="Verified for"
          scope={props.page.id}
          choices={periods}
          selected="90"
        />
        <FormActions>
          <Button type="submit">Mark as verified</Button>
        </FormActions>
      </Action>
    </Section>
  );
}

function OtherCards(props: { readonly page: Page }) {
  const { page } = props;
  const retired = page.status === 'retired';
  return (
    <>
      <Section title="Copy" sub="A new page with the same text, filed beside this one">
        <Action page={page} intent="copy">
          <FormActions>
            <Button type="submit">Copy page</Button>
          </FormActions>
        </Action>
      </Section>
      <Hairline />
      <Section
        title={retired ? 'Restore' : 'Retire'}
        sub={
          retired
            ? 'Shows the page in lists and search again'
            : 'Hides the page from lists and search. Its versions are kept and it can be restored'
        }
      >
        <Action page={page} intent={retired ? 'restore' : 'retire'}>
          <FormActions>
            <Button type="submit">{retired ? 'Restore page' : 'Retire page'}</Button>
          </FormActions>
        </Action>
      </Section>
    </>
  );
}

async function foundOf(c: Context<AppEnv>): Promise<Found | null> {
  const screen = screenKernel(c);
  const pageId = idParam(c.req.param('pageId'));
  if (screen === null || pageId === null) return null;
  const shown = await shownPage(c, screen, pageId);
  return shown === null ? null : { screen, shown };
}

function managedOf(found: Found): Managed | null {
  const { page, canEdit } = found.shown;
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (!canEdit || page.type !== 'knowledge' || !filed.success) return null;
  return { ...found, category: filed.data.jd_category };
}

async function readOnly(c: Context<AppEnv>, found: Found): Promise<Response> {
  const { page } = found.shown;
  const why =
    page.type === 'knowledge'
      ? `Moving, copying or retiring this page needs the editor role in area ${page.jdArea}.`
      : 'Only knowledge pages are moved, copied or retired here.';
  return renderScreen(
    c,
    await pageScreenSpec(c, found.screen, found.shown, pageNames.pageManage),
    <FormShape
      head={{ eyebrow: pageNames.wiki, title: page.title, lede: 'Nothing to manage here.' }}
    >
      <Section title="Read only">
        <p class="m-0 text-sm text-text-2">{why}</p>
        <p class="m-0">
          <a href={pagePath(page.id)} class={pageLink}>
            Back to the page
          </a>
        </p>
      </Section>
    </FormShape>,
  );
}

async function render(
  c: Context<AppEnv>,
  managed: Managed,
  refused: string | null,
): Promise<Response> {
  const { shown, screen } = managed;
  const database = c.get('database');
  const siblings =
    database === null
      ? []
      : ((await pagesInCategory(database.db, screen.caller.actor, managed.category, screen.at)) ??
        []);
  return renderScreen(
    c,
    await pageScreenSpec(c, screen, shown, pageNames.pageManage, siblings),
    <FormShape
      head={{
        eyebrow: pageNames.wiki,
        title: shown.page.title,
        lede: 'Move, copy or retire this page. To change its title or text, edit it.',
      }}
    >
      {refused === null ? null : <Note>{`Not done: ${reasonText(refused)}.`}</Note>}
      <p class="m-0">
        <a href={pagePath(shown.page.id)} class={pageLink}>
          Back to the page
        </a>
      </p>
      <VerifyCard page={shown.page} />
      <Hairline />
      <MoveCard managed={managed} siblings={siblings} />
      <Hairline />
      <OtherCards page={shown.page} />
      <AreaHomeCard page={shown.page} state={await homeStateOf(c, screen, shown.page)} />
    </FormShape>,
  );
}

export async function pageManageScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const found = await foundOf(c);
  if (found === null) return notFound(c);
  const managed = managedOf(found);
  return managed === null ? readOnly(c, found) : render(c, managed, null);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const malformed: PageResult = { ok: false, reason: 'malformed_command' };

async function moved(c: Context<AppEnv>, managed: Managed, posted: Posted): Promise<Outcome> {
  const database = c.get('database');
  const category = text(posted['category']);
  const parent = category === managed.category ? idParam(text(posted['parent'])) : null;
  const command = movePageCommandSchema.safeParse({
    command: 'move_page',
    requestId: posted['requestId'],
    pageId: managed.shown.page.id,
    expectedVersion: Number(posted['expectedVersion']),
    category,
    parentId: parent,
  });
  if (!command.success || database === null) return malformed;
  const { actor, traceId } = managed.screen.caller;
  return movePage(database.db, actor, command.data, traceId, managed.screen.at);
}

async function statusSet(c: Context<AppEnv>, managed: Managed, posted: Posted): Promise<Outcome> {
  const database = c.get('database');
  const { page } = managed.shown;
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted['requestId'],
    pageId: page.id,
    expectedVersion: Number(posted['expectedVersion']),
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: page.bodyMd,
    status: posted['intent'] === 'retire' ? 'retired' : 'active',
  });
  if (!command.success || database === null) return malformed;
  const { actor, traceId } = managed.screen.caller;
  return updatePageWith(database.db, actor, command.data, {
    traceId,
    at: managed.screen.at,
    effects: measurePauses,
  });
}

const DAY_MS = 86_400_000;

async function verified(c: Context<AppEnv>, managed: Managed, posted: Posted): Promise<Outcome> {
  const database = c.get('database');
  const { page } = managed.shown;
  const { actor, traceId } = managed.screen.caller;
  const days = Number(posted['days']);
  if (database === null || !periods.some((period) => Number(period.value) === days)) {
    return malformed;
  }
  const until = formatDate(new Date(managed.screen.at.getTime() + days * DAY_MS));
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted['requestId'],
    pageId: page.id,
    expectedVersion: Number(posted['expectedVersion']),
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter: { ...page.frontmatter, verified_by: actor.identity, verified_until: until },
    bodyMd: page.bodyMd,
    status: page.status,
  });
  if (!command.success) return malformed;
  return updatePageWith(database.db, actor, command.data, {
    traceId,
    at: managed.screen.at,
    effects: measurePauses,
  });
}

async function copied(c: Context<AppEnv>, managed: Managed, posted: Posted): Promise<Outcome> {
  const database = c.get('database');
  if (database === null) return malformed;
  const { actor, traceId } = managed.screen.caller;
  const request = { requestId: posted['requestId'], traceId, at: managed.screen.at };
  return copyPage(database.db, actor, managed.shown.page, request);
}

const actions = new Map([
  ['move', moved],
  ['copy', copied],
  ['verify', verified],
  ['retire', statusSet],
  ['restore', statusSet],
]);

export async function managePage(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const found = await foundOf(c);
  if (found === null) return notFound(c);
  const managed = managedOf(found);
  if (managed === null) return readOnly(c, found);
  const posted = await c.req.parseBody();
  const intent = text(posted['intent']);
  if (intent === 'home') {
    const refused = await changeAreaHome(c, managed.screen, managed.shown.page, posted);
    if (refused !== null) return render(c, managed, refused);
    return c.redirect(wikiAreaPath(managed.shown.page.jdArea), 303);
  }
  const act = actions.get(intent);
  const outcome = act === undefined ? malformed : await act(c, managed, posted);
  if (!outcome.ok) return render(c, managed, outcome.reason);
  if (intent === 'copy') return c.redirect(pageEditPath(outcome.page.id), 303);
  return c.redirect(`${pagePath(outcome.page.id)}?saved=${String(outcome.page.version)}`, 303);
}
