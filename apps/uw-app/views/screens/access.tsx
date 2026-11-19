import type { Context } from 'hono';
import { jdAreaSchema } from '@uw/contracts';
import { formatDate, formatInstant } from '@uw/core/dates';
import { readAccessRecords, type AccessPerson } from '@uw/db/store';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
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
import { accessPath } from '../parts/paths.ts';

const empty = 'm-0 px-4 py-3 text-sm text-text-3';

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

function PersonCell(props: { readonly person: AccessPerson }) {
  return (
    <span class="flex min-w-0 flex-col">
      <span class="font-heavy text-text">{props.person.displayName}</span>
      <span class="text-xs text-text-3">{props.person.email}</span>
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
    <Card title="Waiting for access" sub="Signed in, with nothing they can reach yet" flush>
      {view.waiting.length === 0 ? (
        <p class={empty}>Nobody is waiting.</p>
      ) : (
        <Table
          caption="Waiting for access"
          columns={waitingColumns}
          rows={view.waiting.map((person) => ({
            person: <PersonCell person={person} />,
            status: <StatusBadge status={person.status} holds={false} />,
            decide: decideCell(view, person),
          }))}
          bare
        />
      )}
    </Card>
  );
}

function grantRows(holder: Holder) {
  return holder.grants.map((line) => ({
    person: <PersonCell person={holder.person} />,
    role: line.grant.role,
    scope: scopeLabel(scopeOf(line.grant)),
    status: <StatusBadge status={holder.person.status} holds />,
    by: line.grant.grantedBy ?? 'Set up with the platform',
    on: formatDate(line.grant.grantedAt),
    ends: line.grant.expiresAt === null ? 'No end date' : formatDate(line.grant.expiresAt),
    revoke: line.manageable ? <RevokeControl person={holder.person} line={line} /> : null,
  }));
}

function Holders(props: { readonly view: AccessView; readonly filter: AccessFilter }) {
  const { view } = props;
  return (
    <Card title="Who has access" sub="Live grants you can see" flush>
      <div class="border-b border-line px-4 py-3">
        <FilterForm view={view} filter={props.filter} />
      </div>
      {view.holders.length === 0 ? (
        <p class={empty}>No grants to show.</p>
      ) : (
        <Table
          caption="Who has access"
          columns={grantColumns}
          rows={view.holders.flatMap(grantRows)}
          bare
        />
      )}
    </Card>
  );
}

function History(props: { readonly view: AccessView }) {
  const { history } = props.view;
  return (
    <Card title="History" sub="Who changed what, newest first" flush>
      {history.length === 0 ? (
        <p class={empty}>No changes recorded.</p>
      ) : (
        <Table
          caption="Access history"
          columns={historyColumns}
          rows={history.map((line) => ({ ...line, at: formatInstant(line.at) }))}
          bare
        />
      )}
    </Card>
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
    <>
      <PageHead title={pageNames.access} lede={ledeOf(view)} />
      <KeptOutcome />
      <div class="flex flex-col gap-5">
        {admin ? <Waiting view={view} /> : null}
        {admin ? (
          <Card title="Grant a role" sub="Only in the scopes you’re an admin of">
            <GrantForm view={view} />
          </Card>
        ) : null}
        <Holders view={view} filter={filter} />
        <History view={view} />
      </div>
    </>,
  );
}
