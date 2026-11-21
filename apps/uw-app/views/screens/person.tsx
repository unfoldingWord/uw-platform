import type { Context } from 'hono';
import { can } from '@uw/core/acl';
import { formatDate } from '@uw/core/dates';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { pagesOwnedBy, type PageSummary } from '../../pages/reads.ts';
import { personPage, type PersonPage } from '../../people/directory.ts';
import { StatusBadge } from '../parts/access-forms.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { pagePath, personPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const MOST_OWNED = 50;
const quiet = 'm-0 px-4 py-3 text-sm text-text-3';
const link =
  'rounded-sm font-heavy text-accent-text outline-offset-2 outline-accent-text hover:underline focus-visible:outline-2';

const factColumns = [
  { key: 'fact', label: 'Fact' },
  { key: 'value', label: 'Value' },
];

function About(props: { readonly person: PersonPage }) {
  const { person } = props;
  const rows = [
    {
      fact: 'Email',
      value: (
        <a class={link} href={`mailto:${person.email}`}>
          {person.email}
        </a>
      ),
    },
    { fact: 'Status', value: <StatusBadge status={person.status} holds /> },
    { fact: 'Joined', value: formatDate(person.joinedAt) },
  ];
  return (
    <Card title="About" sub="What the directory holds for them today" flush>
      <Table caption="About this person" columns={factColumns} rows={rows} bare />
    </Card>
  );
}

function Owned(props: { readonly pages: readonly PageSummary[] }) {
  return (
    <Card title="Pages they own" sub="Only pages in areas you can read" flush>
      {props.pages.length === 0 ? (
        <p class={quiet}>None that you can read.</p>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-2 px-4 py-3">
          {props.pages.map((page) => (
            <li>
              <a class={link} href={pagePath(page.id)}>
                {page.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Coming() {
  return (
    <Card title="Still to come" sub="Filled in as the directory grows">
      <p class="m-0 text-sm text-text-3">
        Role, team, contact details, open tasks and the programs and projects they work on appear
        here once the directory holds them.
      </p>
    </Card>
  );
}

export async function personScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const personId = idParam(c.req.param('personId'));
  const person = personId === null ? null : await personPage(database.db, personId);
  const { actor } = screen.caller;
  if (person === null) return notFound(c);
  const resource = { kind: 'person', personId: person.personId, status: person.status } as const;
  if (!can(actor, 'read', resource, screen.at)) return notFound(c);
  const owned = await pagesOwnedBy(
    database.db,
    actor,
    `human:${person.personId}`,
    screen.at,
    MOST_OWNED,
  );
  const here = personPath(person.personId, person.displayName);
  const spec = {
    title: `${person.displayName} · ${pageNames.person}`,
    current: here,
    crumbs: [{ label: pageNames.directory }, { label: person.displayName, href: here }],
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead title={person.displayName} eyebrow={pageNames.person} lede={person.email} />
      <div class="flex flex-col gap-5">
        <About person={person} />
        <Owned pages={owned} />
        <Coming />
      </div>
    </>,
  );
}
