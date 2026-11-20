import { formatInstant } from '@uw/core/dates';
import { Badge } from '@uw/ui/components/badge.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { domId } from '@uw/ui/components/text.ts';
import type { CredentialLine, GrantLine } from '../../credentials/records.ts';
import {
  connectorChoices,
  connectorWord,
  kindChoices,
  revealWindows,
  rotationDue,
  standingOf,
} from './credential-words.ts';

const ENDPOINT = '/api/credentials/commands';
const VALUE_MAX = 65_536;
const NAME_MAX = 120;
const REF_MAX = 5;

const label = 'text-xs font-heavy tracking-wide text-text-3 uppercase';
const control =
  'rounded-md border border-line bg-surface px-3 py-1 text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2';
const hint = 'm-0 text-xs text-text-3';

export type Choice = { readonly value: string; readonly label: string };

function DayField(props: {
  readonly name: string;
  readonly label: string;
  readonly scope: string;
}) {
  const id = domId('field', props.name, props.scope);
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id} class={label}>
        {props.label}
      </label>
      <input id={id} type="date" name={props.name} class={control} />
    </div>
  );
}

function ValueField(props: { readonly scope: string; readonly label: string }) {
  const id = domId('field', 'value', props.scope);
  return (
    <div class="flex w-full min-w-0 flex-col gap-1">
      <label for={id} class={label}>
        {props.label}
      </label>
      <textarea
        id={id}
        name="value"
        rows={3}
        maxlength={VALUE_MAX}
        required
        data-forget=""
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        class={`${control} font-mono`}
      ></textarea>
    </div>
  );
}

export function StandingBadge(props: { readonly line: CredentialLine; readonly at: Date }) {
  const standing = standingOf(props.line, props.at);
  if (standing === 'revoked') return <Badge tone="held">Revoked</Badge>;
  if (standing === 'expired') return <Badge tone="held">Expired</Badge>;
  if (rotationDue(props.line, props.at)) return <Badge tone="info">Rotation due</Badge>;
  return <Badge tone="success">Active</Badge>;
}

export function CreateForm(props: {
  readonly areas: readonly Choice[];
  readonly owners: readonly Choice[];
  readonly self: string | null;
}) {
  return (
    <div class="flex flex-col gap-2">
      <PlatformCommandForm
        endpoint={ENDPOINT}
        command="create_credential"
        scope="new"
        done="Added. The list below shows it."
      >
        <TextField name="name" label="Name" scope="new" maxLength={NAME_MAX} required />
        <SelectField name="kind" label="Kind" scope="new" choices={kindChoices} />
        <SelectField name="jdArea" label="Area" scope="new" choices={props.areas} />
        <TextField
          name="jdRef"
          label="Category or ID"
          scope="new"
          maxLength={REF_MAX}
          placeholder="28 or 28.04"
        />
        <SelectField
          name="ownerId"
          label="Owner"
          scope="new"
          choices={props.owners}
          selected={props.self ?? ''}
        />
        <DayField name="rotateBy" label="Rotate by" scope="new" />
        <DayField name="expiresOn" label="Expires" scope="new" />
        <ValueField scope="new" label="Value" />
        <HumanActionButton
          itemId="new"
          label="Add credential"
          name="decision"
          value="create_credential"
        />
      </PlatformCommandForm>
      <p class={hint}>
        The value is sealed when you add it. Nobody sees it again without a reveal grant, and this
        form forgets what you typed once it is added.
      </p>
    </div>
  );
}

export function RotateForm(props: { readonly credentialId: string }) {
  const { credentialId } = props;
  return (
    <div class="flex flex-col gap-2">
      <PlatformCommandForm
        endpoint={ENDPOINT}
        command="rotate_credential"
        scope={credentialId}
        done="Rotated. The new value is the one in use."
      >
        <input type="hidden" name="credentialId" value={credentialId} />
        <ValueField scope="rotate" label="New value" />
        <DayField name="rotateBy" label="Rotate by" scope="rotate" />
        <DayField name="expiresOn" label="Expires" scope="rotate" />
        <HumanActionButton
          itemId={credentialId}
          label="Rotate"
          name="decision"
          value="rotate_credential"
        />
      </PlatformCommandForm>
      <p class={hint}>
        Rotating replaces the dates too. Leave a date empty and the credential has none.
      </p>
    </div>
  );
}

export function RevokeCredential(props: { readonly line: CredentialLine }) {
  const { line } = props;
  return (
    <details>
      <summary class={`${commandButton} cursor-pointer list-none`}>Revoke this credential</summary>
      <div class="mt-2 flex flex-col gap-2">
        <p class="m-0 text-sm text-text">
          {line.name} stops working everywhere it is bound, and nobody can reveal it. You cannot
          undo this.
        </p>
        <PlatformCommandForm
          endpoint={ENDPOINT}
          command="revoke_credential"
          scope={line.id}
          done={`Revoked ${line.name}.`}
        >
          <input type="hidden" name="credentialId" value={line.id} />
          <HumanActionButton
            itemId={line.id}
            label="Confirm revoke"
            name="decision"
            value="revoke_credential"
          />
        </PlatformCommandForm>
      </div>
    </details>
  );
}

export function BindForm(props: {
  readonly credentialId: string;
  readonly workflows: readonly Choice[];
}) {
  const { credentialId, workflows } = props;
  if (workflows.length === 0) {
    return <p class={hint}>You can open no workflow to bind this credential to.</p>;
  }
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command="bind_credential"
      scope={credentialId}
      done="Bound. The list above shows it."
    >
      <input type="hidden" name="credentialId" value={credentialId} />
      <SelectField name="harnessId" label="Workflow" scope="bind" choices={workflows} />
      <SelectField name="connectorKey" label="Connector" scope="bind" choices={connectorChoices} />
      <HumanActionButton
        itemId={credentialId}
        label="Bind"
        name="decision"
        value="bind_credential"
      />
    </PlatformCommandForm>
  );
}

export function UnbindControl(props: {
  readonly credentialId: string;
  readonly harnessId: string;
  readonly connectorKey: string;
  readonly workflow: string;
}) {
  const where = `${props.workflow}, ${connectorWord(props.connectorKey)}`;
  const scope = `${props.credentialId}-${props.harnessId}-${props.connectorKey}`;
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command="unbind_credential"
      scope={scope}
      done={`Unbound from ${where}.`}
    >
      <input type="hidden" name="credentialId" value={props.credentialId} />
      <input type="hidden" name="harnessId" value={props.harnessId} />
      <input type="hidden" name="connectorKey" value={props.connectorKey} />
      <HumanActionButton
        itemId={scope}
        label={`Unbind from ${where}`}
        name="decision"
        value="unbind_credential"
      />
    </PlatformCommandForm>
  );
}

export function GrantRevealForm(props: {
  readonly credentialId: string;
  readonly seers: readonly Choice[];
  readonly alone: boolean;
}) {
  const { credentialId } = props;
  return (
    <div class="flex flex-col gap-2">
      <PlatformCommandForm
        endpoint={ENDPOINT}
        command="grant_reveal"
        scope={credentialId}
        done={
          props.alone
            ? 'Granted. The list above shows it.'
            : 'Asked. It waits for a second org admin.'
        }
      >
        <input type="hidden" name="credentialId" value={credentialId} />
        <SelectField name="personId" label="Person" scope="reveal" choices={props.seers} />
        <SelectField
          name="minutes"
          label="For"
          scope="reveal"
          choices={revealWindows}
          selected="15"
        />
        <HumanActionButton
          itemId={`${credentialId}-grant`}
          label={props.alone ? 'Give a reveal grant' : 'Ask for a reveal grant'}
          name="decision"
          value="grant_reveal"
        />
      </PlatformCommandForm>
      <p class={hint}>
        {props.alone
          ? 'A reveal grant always ends. The person must also hold a grant on this area.'
          : 'You manage this credential as an org admin, not as an admin of its area. A grant you give waits until a second org admin confirms it, and both of you are recorded.'}
      </p>
    </div>
  );
}

function GrantCommand(props: {
  readonly grant: GrantLine;
  readonly command: 'confirm_reveal' | 'revoke_reveal';
  readonly verb: string;
  readonly done: string;
}) {
  const { grant } = props;
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command={props.command}
      scope={grant.grantId}
      done={`${props.done} ${grant.person}.`}
    >
      <input type="hidden" name="grantId" value={grant.grantId} />
      <HumanActionButton
        itemId={`${grant.grantId}-${props.command}`}
        label={`${props.verb} ${grant.person}`}
        name="decision"
        value={props.command}
      />
    </PlatformCommandForm>
  );
}

export function GrantControls(props: { readonly grant: GrantLine }) {
  const { grant } = props;
  return (
    <div class="flex flex-wrap items-end gap-2">
      {grant.confirmable ? (
        <GrantCommand
          grant={grant}
          command="confirm_reveal"
          verb="Confirm for"
          done="Confirmed the reveal grant for"
        />
      ) : null}
      <GrantCommand
        grant={grant}
        command="revoke_reveal"
        verb="Revoke for"
        done="Revoked the reveal grant for"
      />
    </div>
  );
}

export function RevealControl(props: { readonly line: CredentialLine }) {
  const { line } = props;
  const until = line.revealEndsAt === null ? '' : formatInstant(line.revealEndsAt);
  return (
    <form data-reveal={line.id} method="post" action="#" class="flex flex-col gap-2">
      <p class="m-0 text-sm text-text">
        Your reveal grant ends {until}. Each reveal is recorded and tells the admins of this area.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <HumanActionButton
          itemId={`${line.id}-reveal`}
          label="Reveal the value"
          name="decision"
          value="reveal_credential"
        />
        <button type="button" data-reveal-hide="" hidden class={commandButton}>
          Hide the value
        </button>
      </div>
      <p data-outcome role="status" aria-live="polite" class="m-0 text-sm text-text-3"></p>
      <pre
        data-revealed=""
        hidden
        class="m-0 overflow-x-auto rounded-md border border-line bg-raised p-3 font-mono text-sm break-all whitespace-pre-wrap text-text"
      ></pre>
    </form>
  );
}
