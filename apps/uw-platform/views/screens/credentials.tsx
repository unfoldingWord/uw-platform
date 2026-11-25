import type { Context } from 'hono';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import {
  manageableAreas,
  seenCredentials,
  type CredentialLine,
} from '../../credentials/records.ts';
import { ownerOf } from '../parts/credential-words.ts';
import { Who, type Reading } from '../parts/person.tsx';
import type { AppEnv } from '../../deps.ts';
import { activePeople } from '../../people/directory.ts';
import { KeptOutcome } from '../parts/access-forms.tsx';
import { CreateForm, StandingBadge } from '../parts/credential-forms.tsx';
import { dayOrNone, instantOrNone, kindWord } from '../parts/credential-words.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, everyArea, moduleCodes, pageNames } from '../parts/names.ts';
import { credentialPath, credentialsPath } from '../parts/paths.ts';

const link =
  'font-semibold text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text hover:underline focus-visible:outline-2';

const columns = [
  { key: 'name', label: 'Credential' },
  { key: 'area', label: 'Area' },
  { key: 'owner', label: 'Owner' },
  { key: 'rotate', label: 'Rotate by' },
  { key: 'expires', label: 'Expires' },
  { key: 'used', label: 'Last used' },
  { key: 'status', label: 'Status' },
];

function NameCell(props: { readonly line: CredentialLine }) {
  const { line } = props;
  return (
    <span class="flex min-w-0 flex-col">
      <a href={credentialPath(line.id)} class={link}>
        {line.name}
      </a>
      <span class="text-sm text-text-3">
        {kindWord(line.kind)}
        {line.revealable ? ' · you can reveal it' : ''}
      </span>
    </span>
  );
}

function rowOf(line: CredentialLine, reading: Reading) {
  const { at } = reading;
  return {
    name: <NameCell line={line} />,
    area:
      line.jdRef === null ? areaLabel(line.jdArea) : `${areaLabel(line.jdArea)} · ${line.jdRef}`,
    owner: <Who reading={reading} who={ownerOf(line)} />,
    rotate: dayOrNone(line.rotateBy),
    expires: instantOrNone(line.expiresAt, 'No end'),
    used: instantOrNone(line.lastUsedAt, 'Never'),
    status: <StandingBadge line={line} at={at} />,
  };
}

function ledeOf(lines: readonly CredentialLine[], manages: boolean): string {
  if (manages)
    return 'The credentials of the areas you manage. A value is sealed when you add it and shown only to someone who holds a reveal grant.';
  if (lines.length > 0)
    return 'The credentials of your areas. You see that each one exists, never its value.';
  return 'You see a credential when you hold a grant on its area. Nothing here is open to you yet.';
}

export async function credentialsScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const viewer = screen.caller.actor;
  const lines = await seenCredentials(database.db, viewer, screen.at);
  const areas = manageableAreas(viewer, everyArea(), screen.at);
  const owners = areas.length === 0 ? [] : await activePeople(database.db);
  const spec = {
    title: pageNames.credentials,
    current: credentialsPath(),
    code: moduleCodes.credentials,
    crumbs: [{ label: pageNames.infrastructure }, { label: pageNames.credentials }],
  };
  return renderScreen(
    c,
    spec,
    <ListShape head={{ title: pageNames.credentials, lede: ledeOf(lines, areas.length > 0) }}>
      <KeptOutcome />
      <Section title="Credentials" sub="What you can see" flush>
        {lines.length === 0 ? (
          <EmptyState
            title="No credentials to show."
            text="A credential appears here once you hold a grant on its area."
          />
        ) : (
          <Table
            caption="Credentials"
            columns={columns}
            rows={lines.map((line) => rowOf(line, { reader: screen.caller.actor, at: screen.at }))}
            bare
          />
        )}
      </Section>
      {areas.length === 0 ? null : (
        <Section title="Add a credential" sub="Only in the areas you manage">
          <CreateForm
            areas={areas.map((area) => ({ value: area, label: areaLabel(area) }))}
            owners={owners.map((person) => ({ value: person.personId, label: person.email }))}
            self={viewer.personId}
          />
        </Section>
      )}
    </ListShape>,
  );
}
