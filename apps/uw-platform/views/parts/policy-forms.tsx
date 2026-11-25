import type { Context } from 'hono';
import {
  adoptTemplateUpdateCommandSchema,
  copyTemplatePolicyCommandSchema,
  type Page,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import type { PolicyReading, PolicyTarget } from '../../pages/policy-reading.ts';
import { adoptTemplateUpdate, copyTemplatePolicy } from '../../pages/policy-templates.ts';
import { screenKernel, screenRefusal } from './frame.tsx';
import { idParam } from './params.ts';
import { pagePath, pagePolicyPath } from './paths.ts';
import { levelWords } from './policy-facts.tsx';

export type PolicyForms = {
  readonly page: Page;
  readonly reading: PolicyReading;
  readonly canEdit: boolean;
  readonly targets: readonly PolicyTarget[];
  readonly at: Date;
};

function Adopt(props: { readonly forms: PolicyForms }) {
  const { page, reading } = props.forms;
  const copied = reading.copiedFrom;
  if (copied?.current == null || copied.current <= copied.version) return null;
  return (
    <Section
      title="Template update"
      sub={`The template moved from version ${String(copied.version)} to ${String(copied.current)}`}
    >
      <form method="post" action={pagePolicyPath(page.id)} class="flex flex-col gap-3">
        <input type="hidden" name="intent" value="adopt" />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <input type="hidden" name="expectedVersion" value={String(page.version)} />
        <p class="m-0">
          <Button type="submit" variant="human">
            Adopt the template's new text
          </Button>
        </p>
      </form>
    </Section>
  );
}

function targetChoices(targets: readonly PolicyTarget[]) {
  return [
    { value: '', label: levelWords.organization },
    ...targets.map((target) => ({ value: target.id, label: `${target.title} (${target.type})` })),
  ];
}

function Copy(props: { readonly forms: PolicyForms }) {
  const { page, reading, targets, at } = props.forms;
  if (reading.enforcement !== 'template' || page.status !== 'active') return null;
  const scope = page.id;
  return (
    <Section
      title="Copy this template"
      sub="Makes a suggested policy with this text that names this template and its version"
    >
      <form method="post" action={pagePolicyPath(page.id)} class="flex flex-col gap-3">
        <input type="hidden" name="intent" value="copy" />
        <input type="hidden" name="jdArea" value={page.jdArea} />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <TextField name="title" label="Title" scope={scope} value={page.title} maxLength={200} />
        <SelectField
          name="appliesTo"
          label="Applies to"
          scope={scope}
          choices={targetChoices(targets)}
        />
        <SelectField
          name="enforcement"
          label="Enforcement"
          scope={scope}
          choices={[
            { value: 'default', label: 'Default' },
            { value: 'required', label: 'Required' },
          ]}
        />
        <TextField
          name="effectiveFrom"
          label="In force from"
          scope={scope}
          value={formatDate(at)}
          maxLength={10}
          hint="A date, year first, as in the box"
        />
        <p class="m-0">
          <Button type="submit" variant="human">
            Make the copy
          </Button>
        </p>
      </form>
    </Section>
  );
}

export function PolicyFormsSection(props: {
  readonly forms: PolicyForms | null;
  readonly refused: string | null;
}) {
  const { forms, refused } = props;
  if (forms === null || !forms.canEdit) return null;
  return (
    <div data-pdf-hidden="" class="flex flex-col gap-4">
      {refused === null ? null : <Note>{`Not done: ${reasonText(refused)}.`}</Note>}
      <Adopt forms={forms} />
      <Copy forms={forms} />
    </div>
  );
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function postPolicyForm(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  const pageId = idParam(c.req.param('pageId'));
  if (screen === null || database === null || pageId === null) return screenRefusal(c);
  const posted = await c.req.parseBody();
  const { actor, traceId } = screen.caller;
  const refusedTo = (reason: string) =>
    c.redirect(`${pagePath(pageId)}?refused=${encodeURIComponent(reason)}`, 303);
  if (posted['intent'] === 'adopt') {
    const command = adoptTemplateUpdateCommandSchema.safeParse({
      command: 'adopt_template_update',
      requestId: posted['requestId'],
      pageId,
      expectedVersion: Number(posted['expectedVersion']),
    });
    if (!command.success) return refusedTo('malformed_command');
    const done = await adoptTemplateUpdate(database.db, actor, command.data, traceId, screen.at);
    if (!done.ok) return refusedTo(done.reason);
    return c.redirect(`${pagePath(pageId)}?saved=${String(done.page.version)}`, 303);
  }
  const copyId = crypto.randomUUID();
  const command = copyTemplatePolicyCommandSchema.safeParse({
    command: 'copy_template_policy',
    requestId: posted['requestId'],
    pageId: copyId,
    templateId: pageId,
    jdArea: text(posted['jdArea']),
    title: text(posted['title']).trim(),
    enforcement: posted['enforcement'],
    appliesTo: text(posted['appliesTo']) === '' ? null : text(posted['appliesTo']),
    effectiveFrom: text(posted['effectiveFrom']).trim(),
  });
  if (!command.success) return refusedTo('malformed_command');
  const done = await copyTemplatePolicy(database.db, actor, command.data, traceId, screen.at);
  if (!done.ok) return refusedTo(done.reason);
  return c.redirect(pagePath(copyId), 303);
}
