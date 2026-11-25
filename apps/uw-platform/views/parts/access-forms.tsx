import { roleSchema } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Button, buttonClass } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { SelectField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import type { AccessPerson } from '@uw/db/store';
import {
  scopeLabel,
  scopeOf,
  type AccessFilter,
  type AccessView,
  type GrantLine,
} from './access-view.ts';
import { accessPath } from './paths.ts';
import { EndsField } from './standing-permissions.tsx';

const ACL_ENDPOINT = '/api/acl/commands';

const ALL = '';

const roleWords: ReadonlyMap<string, string> = new Map([
  ['admin', 'Admin: manages the scope and who has access to it'],
  ['editor', 'Editor: reads and changes'],
  ['viewer', 'Viewer: reads only'],
]);

export function StatusBadge(props: { readonly status: string; readonly holds: boolean }) {
  if (props.status === 'pending') return <Badge tone="person">Waiting for approval</Badge>;
  if (props.status === 'disabled') return <Badge tone="held">Declined</Badge>;
  if (props.holds) return <Badge tone="success">Active</Badge>;
  return <Badge tone="neutral">No access yet</Badge>;
}

export function KeptOutcome() {
  return (
    <p
      data-outcome-keep
      role="status"
      aria-live="polite"
      class="m-0 text-sm font-semibold text-text empty:hidden"
    ></p>
  );
}

export function GrantForm(props: { readonly view: AccessView }) {
  const { view } = props;
  const roles = roleSchema.options.map((role) => ({
    value: role,
    label: roleWords.get(role) ?? role,
  }));
  return (
    <div class="flex flex-col gap-2">
      <PlatformCommandForm
        endpoint={ACL_ENDPOINT}
        command="grant_role"
        scope="new"
        done="Granted. The list below shows it."
      >
        <SelectField name="personId" label="Person" scope="grant" choices={view.grantable} />
        <SelectField name="role" label="Role" scope="grant" choices={roles} selected="viewer" />
        <SelectField name="scope" label="Scope" scope="grant" choices={view.grantScopes} />
        <EndsField scope="grant" />
        <HumanActionButton itemId="grant" label="Grant" name="decision" value="grant_role" />
      </PlatformCommandForm>
      <p class="m-0 text-sm text-text-3">
        A grant on an area reaches only that area. With no end date it lasts until someone revokes
        it.
      </p>
    </div>
  );
}

export function RevokeControl(props: { readonly person: AccessPerson; readonly line: GrantLine }) {
  const { grant } = props.line;
  const what = `${grant.role} on ${scopeLabel(scopeOf(grant))}`;
  return (
    <details>
      <summary
        class={`${buttonClass('secondary', 'sm')} list-none`}
        aria-label={`Revoke ${what} for ${props.person.email}`}
      >
        Revoke
      </summary>
      <div class="mt-2 flex flex-col gap-2">
        <p class="m-0 text-sm text-text">
          {props.person.email} loses {what}.
        </p>
        <PlatformCommandForm
          endpoint={ACL_ENDPOINT}
          command="revoke_role"
          scope={grant.grantId}
          done={`Revoked ${what} for ${props.person.email}.`}
        >
          <input type="hidden" name="grantId" value={grant.grantId} />
          <HumanActionButton
            itemId={grant.grantId}
            label="Confirm revoke"
            name="decision"
            value="revoke_role"
          />
        </PlatformCommandForm>
      </div>
    </details>
  );
}

function DecideForm(props: {
  readonly person: AccessPerson;
  readonly command: 'approve_person' | 'decline_person';
  readonly verb: string;
  readonly done: string;
}) {
  const { person } = props;
  return (
    <PlatformCommandForm
      endpoint={ACL_ENDPOINT}
      command={props.command}
      scope={person.personId}
      done={`${props.done} ${person.email}.`}
    >
      <input type="hidden" name="personId" value={person.personId} />
      <HumanActionButton
        itemId={person.personId}
        label={`${props.verb} ${person.email}`}
        name="decision"
        value={props.command}
      />
    </PlatformCommandForm>
  );
}

export function DecideControl(props: { readonly person: AccessPerson }) {
  const { person } = props;
  return (
    <div class="flex flex-wrap items-end gap-2">
      <DecideForm person={person} command="approve_person" verb="Approve" done="Approved" />
      {person.status === 'pending' ? (
        <DecideForm person={person} command="decline_person" verb="Decline" done="Declined" />
      ) : null}
    </div>
  );
}

export function FilterForm(props: { readonly view: AccessView; readonly filter: AccessFilter }) {
  const { view, filter } = props;
  const scopes = [{ value: ALL, label: 'Every scope' }, ...view.filterScopes];
  const people = [{ value: ALL, label: 'Everyone' }, ...view.filterPeople];
  return (
    <form method="get" action={accessPath()} class="flex flex-wrap items-end gap-2">
      <SelectField
        name="scope"
        label="Scope"
        scope="filter"
        choices={scopes}
        selected={filter.scope ?? ALL}
      />
      <SelectField
        name="person"
        label="Person"
        scope="filter"
        choices={people}
        selected={filter.personId ?? ALL}
      />
      <Button type="submit">Filter</Button>
    </form>
  );
}
