import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { pageVersion } from '../../pages/history.ts';
import { acceptSuggestion, rejectSuggestion } from '../../pages/suggestion-decisions.ts';
import { suggestionFor } from '../../pages/suggestions.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { LineChanges } from '../parts/line-changes.tsx';
import { pageNames } from '../parts/names.ts';
import { PageBand } from '../parts/page-read.tsx';
import {
  markOf,
  pageLink,
  pageScreenSpec,
  shownPage,
  type ShownPage,
} from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pagePath, pageSuggestionPath } from '../parts/paths.ts';
import { Who } from '../parts/person.tsx';
import { shownAuthor } from '../parts/person-names.ts';
import { notFound } from './not-found.tsx';

type Found = NonNullable<Awaited<ReturnType<typeof suggestionFor>>>;

type Review = {
  readonly screen: ScreenKernel;
  readonly shown: ShownPage;
  readonly found: Found;
  readonly baseBody: string;
  readonly baseTitle: string;
  readonly baseFrontmatter: unknown;
};

const refusalWords: Readonly<Record<string, string>> = {
  suggestion_changed:
    'The agent changed this suggestion after you opened it. Read the change below again before you decide.',
  stale_version: 'The page has changed since this was suggested, so it can only be rejected.',
};

function refusalText(reason: string): string {
  return new Map(Object.entries(refusalWords)).get(reason) ?? `Not decided: ${reasonText(reason)}.`;
}

const statusWords: Readonly<Record<string, string>> = {
  accepted: 'This suggested change was accepted.',
  rejected: 'This suggested change was rejected.',
};

function frontmatterText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function Decide(props: { readonly review: Review }) {
  const { shown, found } = props.review;
  const stale = found.set.baseVersion !== shown.page.version;
  return (
    <Section
      title="Decide"
      sub="Accepting saves the suggested text as one new version. Rejecting leaves the page as it is"
    >
      {stale ? (
        <Note>The page has changed since this was suggested, so it can only be rejected.</Note>
      ) : null}
      <form
        method="post"
        action={pageSuggestionPath(shown.page.id, found.set.id)}
        class="flex flex-wrap gap-3"
      >
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <input type="hidden" name="revision" value={String(found.set.revision)} />
        {stale ? null : (
          <Button type="submit" variant="human" name="intent" value="accept_suggestion">
            Accept the change
          </Button>
        )}
        <Button type="submit" variant="secondary" name="intent" value="reject_suggestion">
          Reject the change
        </Button>
      </form>
    </Section>
  );
}

function Changes(props: { readonly review: Review }) {
  const { found, baseBody, baseTitle, baseFrontmatter } = props.review;
  const { set } = found;
  return (
    <>
      {set.title === baseTitle ? null : (
        <Note>{`The title changes from "${baseTitle}" to "${set.title}".`}</Note>
      )}
      <Section title="Text" sub={`Against version ${String(set.baseVersion)}`}>
        <LineChanges before={baseBody} after={set.bodyMd} same="The text does not change." />
      </Section>
      <Section title="Properties" sub={`Against version ${String(set.baseVersion)}`}>
        <LineChanges
          before={frontmatterText(baseFrontmatter)}
          after={frontmatterText(set.frontmatter)}
          same="The properties do not change."
        />
      </Section>
    </>
  );
}

async function render(c: Context<AppEnv>, review: Review, refused: string | null) {
  const { screen, shown, found } = review;
  const reading = { reader: screen.caller.actor, at: screen.at };
  const suggester = await shownAuthor(c.get('database')?.db ?? null, found.set.proposedBy);
  const spec = await pageScreenSpec(c, screen, shown, pageNames.pageSuggestion);
  const decided = statusWords[found.set.status] ?? null;
  return renderScreen(
    c,
    spec,
    <DocumentShape
      band={
        <PageBand
          status={
            <p class="m-0 flex flex-wrap items-center gap-2">
              <span>Suggested by</span>
              <Who reading={reading} who={suggester} />
              <span>{`on ${formatInstant(found.set.proposedAt)}`}</span>
            </p>
          }
          actions={
            <a href={pagePath(shown.page.id)} class={pageLink}>
              Back to the page
            </a>
          }
        />
      }
      head={{
        eyebrow: markOf(shown.page),
        title: `Suggested change to ${shown.page.title}`,
        lede: 'An agent proposed this change. Nothing reaches readers until a person accepts it.',
      }}
    >
      {refused === null ? null : <Note>{refusalText(refused)}</Note>}
      {decided === null ? null : <Note>{decided}</Note>}
      <Changes review={review} />
      {decided === null && shown.canEdit ? <Decide review={review} /> : null}
    </DocumentShape>,
  );
}

async function reviewOf(c: Context<AppEnv>): Promise<Review | null> {
  const screen = screenKernel(c);
  const database = c.get('database');
  const pageId = idParam(c.req.param('pageId'));
  const suggestionId = idParam(c.req.param('suggestionId'));
  if (screen === null || database === null || pageId === null || suggestionId === null) {
    return null;
  }
  const { actor } = screen.caller;
  const found = await suggestionFor(database.db, actor, suggestionId, screen.at);
  if (found?.page.id !== pageId) return null;
  const shown = await shownPage(c, screen, pageId);
  if (shown === null) return null;
  const at = { pageId, version: found.set.baseVersion };
  const base = await pageVersion(database.db, actor, at, screen.at);
  const page = base?.page ?? shown.page;
  return {
    screen,
    shown,
    found,
    baseBody: page.bodyMd,
    baseTitle: page.title,
    baseFrontmatter: page.frontmatter,
  };
}

export async function pageSuggestionScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const review = await reviewOf(c);
  return review === null ? notFound(c) : render(c, review, null);
}

const deciders = {
  accept_suggestion: acceptSuggestion,
  reject_suggestion: rejectSuggestion,
} as const;

type Intent = keyof typeof deciders;

function intentOf(raw: unknown): Intent | null {
  return raw === 'accept_suggestion' || raw === 'reject_suggestion' ? raw : null;
}

function decide(
  review: Review,
  db: Parameters<typeof acceptSuggestion>[0],
  intent: Intent,
  { requestId, revision }: { readonly requestId: string; readonly revision: number },
) {
  const { actor, traceId } = review.screen.caller;
  const command = { requestId, suggestionId: review.found.set.id, revision };
  return intent === 'accept_suggestion'
    ? deciders.accept_suggestion(
        db,
        actor,
        { command: intent, ...command },
        traceId,
        review.screen.at,
      )
    : deciders.reject_suggestion(
        db,
        actor,
        { command: intent, ...command },
        traceId,
        review.screen.at,
      );
}

function formOf(posted: Readonly<Record<string, unknown>>) {
  const requestId = idParam(String(posted['requestId'] ?? ''));
  const intent = intentOf(posted['intent']);
  const revision = Number(posted['revision']);
  if (requestId === null || intent === null || !Number.isInteger(revision)) return null;
  return { requestId, intent, revision };
}

export async function decideSuggestion(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const review = await reviewOf(c);
  const database = c.get('database');
  if (review === null || database === null || !review.shown.canEdit) return notFound(c);
  const form = formOf(await c.req.parseBody());
  if (form === null) return render(c, review, 'malformed_command');
  const { intent } = form;
  const decided = await decide(review, database.db, intent, form);
  if (!decided.ok) return render(c, review, decided.reason);
  const saved = intent === 'accept_suggestion' ? `?saved=${String(decided.page.version)}` : '';
  return c.redirect(`${pagePath(review.shown.page.id)}${saved}`, 303);
}
