import type { Context } from 'hono';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { policyList, type ListedPolicy } from '../../pages/policy-reading.ts';
import { templateDriftFor, type DriftEntry } from '../../pages/policy-templates.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { pageStatusWords } from '../parts/page-status.tsx';
import { TargetLink, enforcementLabels, inForceWords, levelWords } from '../parts/policy-facts.tsx';
import { pagePath, wikiPath, wikiPoliciesPath } from '../parts/paths.ts';
import { wikiBranch } from '../parts/wiki-tree.ts';

const spec = {
  title: pageNames.wikiPolicies,
  current: wikiPath(),
  code: moduleCodes.pages,
  crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.wikiPolicies }],
};

const rowLink =
  'font-semibold text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

const policyColumns = [
  { key: 'policy', label: 'Policy' },
  { key: 'level', label: 'Level' },
  { key: 'target', label: 'Applies to' },
  { key: 'enforcement', label: 'Enforcement' },
  { key: 'inForce', label: 'In force' },
  { key: 'status', label: 'Status' },
  { key: 'conflicts', label: 'Conflicts', numeric: true },
];

const driftColumns = [
  { key: 'copy', label: 'Copy' },
  { key: 'template', label: 'Template' },
  { key: 'versions', label: 'Copied, now' },
  { key: 'state', label: 'State' },
];

const driftWords: Readonly<Record<DriftEntry['state'], string>> = {
  behind: 'Behind its template',
  source_retired: 'Template retired',
  source_missing: 'Template not found',
};

function policyRow({ page, reading }: ListedPolicy) {
  return {
    policy: (
      <a href={pagePath(page.id)} class={rowLink}>
        {page.title}
      </a>
    ),
    level: levelWords[reading.level],
    target: <TargetLink reading={reading} />,
    enforcement: enforcementLabels[reading.enforcement],
    inForce: inForceWords(reading),
    status: pageStatusWords(page.status),
    conflicts: String(reading.conflicts.length),
  };
}

function driftRow(entry: DriftEntry) {
  return {
    copy: (
      <a href={pagePath(entry.copy.id)} class={rowLink}>
        {entry.copy.title}
      </a>
    ),
    template:
      entry.source === null ? (
        'A page you cannot read'
      ) : (
        <a href={pagePath(entry.source.id)} class={rowLink}>
          {entry.source.title}
        </a>
      ),
    versions: `${String(entry.copied)}, ${entry.current === null ? 'unknown' : String(entry.current)}`,
    state: driftWords[entry.state],
  };
}

export async function wikiPoliciesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const reader = { actor: screen.caller.actor, at: screen.at };
  const policies = await policyList(database.db, reader);
  const drift = await templateDriftFor(database.db, reader.actor, reader.at);
  const branch = await wikiBranch(database.db, reader.actor, reader.at, {});
  return renderScreen(
    c,
    { ...spec, branch, current: wikiPoliciesPath() },
    <ListShape
      head={{
        eyebrow: pageNames.wiki,
        title: 'Policies',
        lede: 'Every policy you can read, with the level it binds at and how. A policy below can replace a default above it, never a required one.',
      }}
    >
      {policies.length === 0 ? (
        <EmptyState title="No policies yet" text="No policy you can read has been written." />
      ) : (
        <Table caption="Policies" columns={policyColumns} rows={policies.map(policyRow)} />
      )}
      <Section
        title="Copies behind their template"
        sub="Open a copy and adopt the new version of its template from its page"
      >
        {drift.length === 0 ? (
          <p class="m-0 text-sm text-text-2">Every copy you can read matches its template.</p>
        ) : (
          <Table caption="Template copies" columns={driftColumns} rows={drift.map(driftRow)} />
        )}
      </Section>
    </ListShape>,
  );
}
