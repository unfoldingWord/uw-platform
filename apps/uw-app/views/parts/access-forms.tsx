import { roleSchema } from '@uw/contracts';
import { Badge } from '@uw/ui/components/badge.tsx';
import { PlatformCommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
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

export function StatusBadge(props: { readonly status: string }) {
  if (props.status === 'pending') return <Badge tone="person">Waiting for approval</Badge>;
  if (props.status === 'disabled') return <Badge tone="held">Declined</Badge>;
  return <Badge tone="neutral">No access yet</Badge>;
}

export function GrantForm(props: { readonly view: AccessView }) {
  const { view } = props;
  const roles = roleSchema.options.map((role) => ({
    value: role,
    label: roleWords.get(role) ?? role,
  }));
  return (
    <div class="flex flex-col gap-2">
      <PlatformCommandForm endpoint={ACL_ENDPOINT} command="grant_role" scope="new">
        <SelectField name="personId" label="Person" scope="grant" choices={view.grantable} />
        <SelectField name="role" label="Role" scope="grant" choices={roles} selected="viewer" />
        <SelectField name="scope" label="Scope" scope="grant" choices={view.grantScopes} />
        <EndsField scope="grant" />
        <HumanActionButton itemId="grant" label="Grant" name="decision" value="grant_role" />
      </PlatformCommandForm>
      <p class="m-0 text-xs text-text-3">
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
        class={`${commandButton} cursor-pointer list-none`}
        aria-label={`Revoke ${what} for ${props.person.email}`}
      >
        Revoke
      </summary>
      <div class="mt-2 flex flex-col gap-2">
        <p class="m-0 text-sm text-text">
          {props.person.email} loses {what}.
        </p>
        <PlatformCommandForm endpoint={ACL_ENDPOINT} command="revoke_role" scope={grant.grantId}>
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

export function DecideControl(props: { readonly person: AccessPerson }) {
  const { person } = props;
  return (
    <PlatformCommandForm endpoint={ACL_ENDPOINT} command="decide" scope={person.personId}>
      <input type="hidden" name="personId" value={person.personId} />
      <HumanActionButton
        itemId={person.personId}
        label={`Approve ${person.email}`}
        name="decision"
        value="approve_person"
      />
      {person.status === 'pending' ? (
        <HumanActionButton
          itemId={person.personId}
          label={`Decline ${person.email}`}
          name="decision"
          value="decline_person"
        />
      ) : null}
    </PlatformCommandForm>
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
      <button type="submit" class={commandButton}>
        Filter
      </button>
    </form>
  );
}
