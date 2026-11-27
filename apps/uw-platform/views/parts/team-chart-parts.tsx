import { COMMITMENT_TEXT_MOST } from '@uw/contracts';
import { Button } from '@uw/ui/components/button.tsx';
import { PlatformCommandForm } from '@uw/ui/components/command-form.tsx';
import { Disclosure } from '@uw/ui/components/disclosure.tsx';
import { SelectField, TextField } from '@uw/ui/components/field.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { teamChartsPath, teamCommandsPath } from './paths.ts';

type Choice = { readonly value: string; readonly label: string };
export type Listed = { readonly id: string; readonly label: string };

const ENDPOINT = teamCommandsPath();

function RemoveForm(props: {
  readonly command: 'remove_commitment' | 'remove_staff_allocation';
  readonly field: 'commitmentId' | 'allocationId';
  readonly row: Listed;
}) {
  return (
    <PlatformCommandForm
      endpoint={ENDPOINT}
      command={props.command}
      scope={props.row.id}
      done={`Removed: ${props.row.label}. Reload to redraw the charts.`}
      inline
    >
      <span class="min-w-0 flex-1 text-sm text-text">{props.row.label}</span>
      <input type="hidden" name={props.field} value={props.row.id} />
      <Button type="submit" variant="ghost" size="sm" label={`Remove ${props.row.label}`}>
        Remove
      </Button>
    </PlatformCommandForm>
  );
}

function Rows(props: {
  readonly rows: readonly Listed[];
  readonly empty: string;
  readonly command: 'remove_commitment' | 'remove_staff_allocation';
  readonly field: 'commitmentId' | 'allocationId';
}) {
  if (props.rows.length === 0) return <p class="m-0 text-sm text-text-3">{props.empty}</p>;
  return (
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {props.rows.map((row) => (
        <li>
          <RemoveForm command={props.command} field={props.field} row={row} />
        </li>
      ))}
    </ul>
  );
}

export type CommitmentsOf = {
  readonly id: string;
  readonly name: string;
  readonly own: boolean;
};

export type Chooser = { readonly people: readonly Choice[]; readonly chosen: boolean };

function PersonChooser(props: { readonly chooser: Chooser; readonly personId: string }) {
  return (
    <form method="get" action={teamChartsPath()} class="flex flex-wrap items-end gap-2">
      <SelectField
        name="person"
        label="Whose commitments"
        scope="commitments-of"
        choices={props.chooser.people}
        selected={props.personId}
      />
      <Button type="submit">Show</Button>
    </form>
  );
}

function commitmentWords(person: CommitmentsOf) {
  if (person.own) {
    return {
      title: 'Your commitments',
      summary: 'Edit your commitments',
      empty: 'You have named no one yet.',
    };
  }
  return {
    title: `Commitments by ${person.name}`,
    summary: `Edit commitments by ${person.name}`,
    empty: `${person.name} has named no one yet.`,
  };
}

export function CommitmentEditor(props: {
  readonly person: CommitmentsOf;
  readonly mine: readonly Listed[];
  readonly colleagues: readonly Choice[];
  readonly chooser: Chooser | null;
}) {
  const choices = [{ value: '', label: 'Someone not listed' }, ...props.colleagues];
  const words = commitmentWords(props.person);
  return (
    <Section title={words.title} headingId="commitments-edit-heading" tight>
      <Disclosure summary={words.summary} open={props.chooser?.chosen === true}>
        {props.chooser === null ? null : (
          <PersonChooser chooser={props.chooser} personId={props.person.id} />
        )}
        <Rows
          rows={props.mine}
          empty={words.empty}
          command="remove_commitment"
          field="commitmentId"
        />
        <PlatformCommandForm
          endpoint={ENDPOINT}
          command="add_commitment"
          scope="new"
          done="Added. Reload to redraw the charts."
        >
          <input type="hidden" name="fromPersonId" value={props.person.id} />
          <SelectField name="toPersonId" label="Colleague" scope="commitment" choices={choices} />
          <TextField
            name="toText"
            label="Or a name, when they are not listed"
            scope="commitment"
            maxLength={COMMITMENT_TEXT_MOST}
          />
          <Button type="submit">Add</Button>
        </PlatformCommandForm>
      </Disclosure>
    </Section>
  );
}

export function AllocationEditor(props: {
  readonly allocations: readonly Listed[];
  readonly people: readonly Choice[];
  readonly targets: readonly Choice[];
}) {
  return (
    <Section title="Staff allocations" headingId="allocations-edit-heading" tight>
      <Disclosure summary="Edit staff allocations" open={false}>
        <Rows
          rows={props.allocations}
          empty="No one is allocated yet."
          command="remove_staff_allocation"
          field="allocationId"
        />
        <PlatformCommandForm
          endpoint={ENDPOINT}
          command="set_staff_allocation"
          scope="new"
          done="Saved. Reload to redraw the charts."
        >
          <SelectField name="personId" label="Person" scope="allocation" choices={props.people} />
          <SelectField
            name="target"
            label="Program or portfolio"
            scope="allocation"
            choices={props.targets}
          />
          <TextField
            name="percent"
            label="Percent of time"
            scope="allocation"
            maxLength={3}
            hint="A whole number from 0 to 100. Leave it blank when it is not known."
          />
          <Button type="submit">Save</Button>
        </PlatformCommandForm>
      </Disclosure>
    </Section>
  );
}
