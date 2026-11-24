import type { Context } from 'hono';
import { jdAreaSchema } from '@uw/contracts';
import { formatDate, formatInstant } from '@uw/core/dates';
import { readAccessRecords, type AccessPerson } from '@uw/db/store';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import {
  DecideControl,
  KeptOutcome,
  FilterForm,
  GrantForm,
  RevokeControl,
  StatusBadge,
} from '../parts/access-forms.tsx';
import {
  ORG_SCOPE,
  accessViewOf,
  grantedByOf,
  historyQueryOf,
  scopeLabel,
  scopeOf,
  type AccessFilter,
  type AccessView,
  type Holder,
} from '../parts/access-view.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { Person, Who } from '../parts/person.tsx';
import { accessPath } from '../parts/paths.ts';

const waitingColumns = [
  { key: 'person', label: 'Person' },
  { key: 'status', label: 'Status' },
  { key: 'decide', label: 'Decide' },
];

const grantColumns = [
  { key: 'person', label: 'Person' },
  { key: 'role', label: 'Role' },
  { key: 'scope', label: 'Scope' },
  { key: 'status', label: 'Status' },
  { key: 'by', label: 'Granted by' },
  { key: 'on', label: 'Granted' },
  { key: 'ends', label: 'Ends' },
  { key: 'revoke', label: 'Revoke' },
];

const historyColumns = [
  { key: 'at', label: 'When' },
  { key: 'actor', label: 'Who' },
  { key: 'action', label: 'Change' },
  { key: 'person', label: 'For' },
  { key: 'detail', label: 'What' },
];

function filterOf(c: Context<AppEnv>): AccessFilter {
  const scope = c.req.query('scope');
  const area = jdAreaSchema.safeParse(scope);
  return {
    scope: scope === ORG_SCOPE ? ORG_SCOPE : area.success ? area.data : null,
    personId: idParam(c.req.query('person')),
  };
}

function PersonCell(props: { readonly view: AccessView; readonly person: AccessPerson }) {
  const { person, view } = props;
  const name = view.names.get(person.personId);
  return (
    <span class="flex min-w-0 flex-col items-start gap-1">
      {name === undefined ? null : <Person reading={view.reading} person={name} />}
      <span class="text-sm text-text-3">{person.email}</span>
    </span>
  );
}

function decideCell(view: AccessView, person: AccessPerson) {
  if (person.status === 'active') return 'Give them a role below';
  if (!view.orgAdmin) return 'An org admin approves sign-ins';
  return <DecideControl person={person} />;
}

function Waiting(props: { readonly view: AccessView }) {
  const { view } = props;
  return (
    <Section title="Waiting for access" sub="Signed in, with nothing they can reach yet" flush>
      {view.waiting.length === 0 ? (
        <EmptyState
          title="Nobody is waiting."
          text="People who sign in with no grant appear here."
        />
      ) : (
        <Table
          caption="Waiting for access"
          columns={waitingColumns}
          rows={view.waiting.map((person) => ({
            person: <PersonCell view={view} person={person} />,
            status: <StatusBadge status={person.status} holds={false} />,
            decide: decideCell(view, person),
          }))}
          bare
        />
      )}
    </Section>
  );
}

function grantRows(view: AccessView, holder: Holder) {
  return holder.grants.map((line) => ({
    person: <PersonCell view={view} person={holder.person} />,
    role: line.grant.role,
    scope: scopeLabel(scopeOf(line.grant)),
    status: <StatusBadge status={holder.person.status} holds />,
    by: <Who reading={view.reading} who={grantedByOf(view.names, line.grant.grantedBy)} />,
    on: formatDate(line.grant.grantedAt),
    ends: line.grant.expiresAt === null ? 'No end date' : formatDate(line.grant.expiresAt),
    revoke: line.manageable ? <RevokeControl person={holder.person} line={line} /> : null,
  }));
}

function Holders(props: { readonly view: AccessView; readonly filter: AccessFilter }) {
  const { view } = props;
  return (
    <Section title="Who has access" sub="Live grants you can see">
      <FilterForm view={view} filter={props.filter} />
      {view.holders.length === 0 ? (
        <EmptyState title="No grants to show." text="Change the scope or person to see more." />
      ) : (
        <Table
          caption="Who has access"
          columns={grantColumns}
          rows={view.holders.flatMap((holder) => grantRows(view, holder))}
          bare
        />
      )}
    </Section>
  );
}

function History(props: { readonly view: AccessView }) {
  const { history } = props.view;
  return (
    <Section title="History" sub="Who changed what, newest first" flush>
      {history.length === 0 ? (
        <EmptyState title="No changes recorded." />
      ) : (
        <Table
          caption="Access history"
          columns={historyColumns}
          rows={history.map((line) => ({
            ...line,
            at: formatInstant(line.at),
            actor: <Who reading={props.view.reading} who={line.actor} />,
            person: <Who reading={props.view.reading} who={line.person} />,
          }))}
          bare
        />
      )}
    </Section>
  );
}

function ledeOf(view: AccessView): string {
  if (view.orgAdmin) return 'Everyone’s grants across the organization, and who is waiting.';
  if (view.grantScopes.length > 0)
    return 'The grants on the areas you’re an admin of, and your own.';
  return 'Your own grants. An admin of an area can change them.';
}

export async function accessScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const filter = filterOf(c);
  const viewer = screen.caller.actor;
  const history = historyQueryOf(viewer, filter, screen.at);
  const records = await readAccessRecords(database.db, screen.at, history);
  const view = accessViewOf(records, viewer, filter, screen.at);
  const admin = view.grantScopes.length > 0;
  const spec = {
    title: pageNames.access,
    current: accessPath(),
    code: moduleCodes.access,
    crumbs: [{ label: pageNames.infrastructure }, { label: pageNames.access }],
  };
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.access, lede: ledeOf(view) }}>
      <KeptOutcome />
      {admin ? <Waiting view={view} /> : null}
      {admin ? (
        <Section title="Grant a role" sub="Only in the scopes you’re an admin of">
          <GrantForm view={view} />
        </Section>
      ) : null}
      <Holders view={view} filter={filter} />
      <History view={view} />
    </ListShape>,
  );
}
