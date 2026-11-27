import type { Context } from 'hono';
import { proposeReviewSetCommandSchema, type SuggestedChangeInput } from '@uw/contracts';
import { Button } from '@uw/ui/components/button.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { FormActions, FormShape } from '@uw/ui/shapes/form.tsx';
import type { AppEnv } from '../../deps.ts';
import { exportSource } from '../../markdown/export.ts';
import { importedMarks, type MarkedImport } from '../../markdown/export-verify.ts';
import { proposeReviewSet } from '../../pages/review-sets.ts';
import { suggestedChangesBetween } from '../../pages/word-diff.ts';
import { pageSourceHash } from '../../pdf/page-source.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { pageLink, pageScreenSpec, shownPage, type ShownPage } from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pagePath, pageReviewNewPath, pageReviewSetPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

type Asking = { readonly screen: ScreenKernel; readonly shown: ShownPage };

type Typed = { readonly name: string; readonly proposed: string; readonly marked: string };

const MOST_TEXT = 1_000_000;

const refusalWords: Readonly<Record<string, string>> = {
  anchor_orphaned: 'Some marked changes no longer match the page text, so nothing was suggested.',
  changes_overlap: 'Some changes overlap each other, so nothing was suggested.',
  stale_version: 'The page changed while you were writing. Start again from its new text.',
  nothing_changed: 'Nothing differs from the page, so there is nothing to suggest.',
  export_unreadable:
    'This export has lost its stamp, so its changes cannot be matched to the page. Export it again.',
  export_other_page: 'This export is of another page, so nothing was suggested.',
  export_earlier_version:
    'This export is of an earlier version of the page. Export the current version and mark your changes again.',
  export_not_marked:
    'Only an export with suggested changes brings them back. Export the page with suggested changes.',
  export_mismatch: 'This export does not match the stored page, so nothing was suggested.',
};

function refusalText(reason: string): string {
  return (
    new Map(Object.entries(refusalWords)).get(reason) ?? `Not suggested: ${reasonText(reason)}.`
  );
}

function ReadOnly(props: { readonly shown: ShownPage }) {
  return (
    <Section title="Read only">
      <p class="m-0 text-sm text-text-2">You can read this page but not suggest changes to it.</p>
      <p class="m-0">
        <a href={pagePath(props.shown.page.id)} class={pageLink}>
          Back to the page
        </a>
      </p>
    </Section>
  );
}

function Proposal(props: { readonly shown: ShownPage; readonly typed: Typed }) {
  const { shown, typed } = props;
  const scope = shown.page.id;
  return (
    <form method="post" action={pageReviewNewPath(shown.page.id)} class="flex flex-col gap-5">
      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
      <input type="hidden" name="baseVersion" value={String(shown.page.version)} />
      <TextField
        name="name"
        label="Name"
        scope={scope}
        maxLength={200}
        value={typed.name}
        required
      />
      <TextAreaField
        name="proposed"
        label="Text with your changes"
        scope={scope}
        rows={16}
        maxLength={MOST_TEXT}
        value={typed.proposed}
        hint="Edit the text. Each word you change becomes a suggested change."
      />
      <TextAreaField
        name="marked"
        label="Or a marked export"
        scope={scope}
        rows={6}
        maxLength={MOST_TEXT}
        value={typed.marked}
        hint="Paste a markdown export with CriticMarkup to bring its suggested changes back."
      />
      <FormActions>
        <a href={pagePath(shown.page.id)} class={pageLink}>
          Cancel
        </a>
        <Button type="submit" variant="human">
          Suggest these changes
        </Button>
      </FormActions>
    </form>
  );
}

async function render(c: Context<AppEnv>, asking: Asking, typed: Typed, refused: string | null) {
  const { screen, shown } = asking;
  return renderScreen(
    c,
    await pageScreenSpec(c, screen, shown, pageNames.pageReviewNew),
    <FormShape
      head={{
        eyebrow: pageNames.wiki,
        title: `Suggest changes to ${shown.page.title}`,
        lede: 'Your changes are kept as a review set. The page changes only when a person accepts it.',
      }}
    >
      {refused === null ? null : <Note>{refusalText(refused)}</Note>}
      {shown.canEdit ? <Proposal shown={shown} typed={typed} /> : <ReadOnly shown={shown} />}
    </FormShape>,
  );
}

async function askingOf(c: Context<AppEnv>): Promise<Asking | null> {
  const screen = screenKernel(c);
  const pageId = idParam(c.req.param('pageId'));
  if (screen === null || pageId === null) return null;
  const shown = await shownPage(c, screen, pageId);
  return shown === null ? null : { screen, shown };
}

export async function pageReviewNewScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const asking = await askingOf(c);
  if (asking === null) return notFound(c);
  const typed = { name: '', proposed: asking.shown.page.bodyMd, marked: '' };
  return render(c, asking, typed, null);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function typedOf(posted: Readonly<Record<string, unknown>>): Typed {
  return {
    name: textOf(posted['name']),
    proposed: textOf(posted['proposed']),
    marked: textOf(posted['marked']),
  };
}

type Db = Parameters<typeof proposeReviewSet>[0];

async function marksOf(db: Db, asking: Asking, typed: Typed): Promise<MarkedImport> {
  const { page } = asking.shown;
  if (typed.marked.trim() === '') {
    return { ok: true, changes: suggestedChangesBetween(page.bodyMd, typed.proposed) };
  }
  const reader = { db, actor: asking.screen.caller.actor, at: asking.screen.at };
  const hash = await pageSourceHash(reader, page);
  const target = { source: exportSource(page), sha256: hash.sourceSha256, bodyMd: page.bodyMd };
  return importedMarks(typed.marked, target);
}

async function changesOf(
  db: Db,
  asking: Asking,
  typed: Typed,
): Promise<SuggestedChangeInput[] | string> {
  const imported = await marksOf(db, asking, typed);
  if (!imported.ok) return imported.why;
  return imported.changes.length === 0 ? 'nothing_changed' : [...imported.changes];
}

export async function proposeFromForm(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const asking = await askingOf(c);
  const database = c.get('database');
  if (asking === null || database === null || !asking.shown.canEdit) return notFound(c);
  const posted = await c.req.parseBody();
  const typed = typedOf(posted);
  const changes = await changesOf(database.db, asking, typed);
  if (typeof changes === 'string') return render(c, asking, typed, changes);
  const command = proposeReviewSetCommandSchema.safeParse({
    command: 'propose_review_set',
    requestId: posted['requestId'],
    pageId: asking.shown.page.id,
    baseVersion: Number(posted['baseVersion']),
    name: typed.name,
    changes,
  });
  if (!command.success) return render(c, asking, typed, 'malformed_command');
  const { actor, traceId } = asking.screen.caller;
  const held = await proposeReviewSet(database.db, actor, command.data, traceId, asking.screen.at);
  if (!held.ok || held.reviewSetId === undefined) {
    return render(c, asking, typed, held.ok ? 'internal_error' : held.reason);
  }
  return c.redirect(pageReviewSetPath(asking.shown.page.id, held.reviewSetId), 303);
}
