import type { Context } from 'hono';
import { formatDate, formatInstant } from '@uw/core/dates';
import type { HealthIndicator, HealthReport, Principal } from '@uw/contracts';
import type { FrameCounts } from '@uw/harness';
import type { Frame } from '@uw/ui/components/shell.tsx';
import type { NavSection, Person } from '@uw/ui/components/sidebar.tsx';
import { markPath } from '@uw/ui/generated/mark';
import type { AppEnv } from '../../deps.ts';
import { commitOf, environmentOf } from '../../env.ts';
import { boardPath, gatesPath, healthPath, homePath } from './paths.ts';
import { pageNames, sectionNames } from './names.ts';

const noCounts: FrameCounts = { harnesses: [], waiting: 0, gatesOpen: 0, agentsWorking: 0 };

function words(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function personOf(principal: Principal | null): Person | null {
  if (principal === null || principal.email === null) return null;
  const parts = (principal.email.split('@')[0] ?? '').split(/[._-]+/).filter(Boolean);
  const name = parts.map(words).join(' ');
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const grant = principal.grants[0];
  const role = grant === undefined ? 'no role' : `${grant.role} · ${grant.scopeArea ?? 'org'}`;
  return { initials, name, role };
}

function watching(report: HealthReport | null): number {
  const hot = (indicator: HealthIndicator) =>
    indicator.status === 'amber' || indicator.status === 'red';
  return report === null ? 0 : report.indicators.filter(hot).length;
}

function switchedOn(report: HealthReport | null, name: string): boolean {
  const found = report?.indicators.find((indicator) => indicator.name === name);
  return found !== undefined && found.status !== 'not_configured' && found.status !== 'not_wired';
}

export function sectionsOf(counts: FrameCounts, watch: number): readonly NavSection[] {
  const waiting = counts.waiting;
  return [
    {
      items: [
        { label: pageNames.home, mark: { icon: 'house' }, href: homePath() },
        {
          label: pageNames.waiting,
          mark: { icon: 'inbox' },
          href: gatesPath(),
          ...(waiting === 0
            ? {}
            : { count: { kind: 'person', count: waiting, label: `${waiting} waiting on you` } }),
        },
        { label: pageNames.myItems, mark: { icon: 'user' } },
      ],
    },
    {
      heading: sectionNames.harness,
      items: [
        ...counts.harnesses.map(({ harness, open }) => ({
          label: harness.title,
          mark: { initial: harness.title.charAt(0).toUpperCase() },
          href: boardPath(harness.id),
          count: { kind: 'quiet' as const, text: String(open) },
        })),
        { label: pageNames.personas, mark: { icon: 'robot' } },
      ],
    },
    {
      heading: sectionNames.system,
      items: [
        {
          label: pageNames.health,
          mark: { icon: 'wave-pulse' },
          href: healthPath(),
          ...(watch === 0 ? {} : { count: { kind: 'watch', text: `${watch} watch` } }),
        },
      ],
    },
  ];
}

const reachableIn = /^reachable in (\d+) ms$/;

function databaseMsOf(report: HealthReport | null): number | null {
  const found = report?.indicators.find((indicator) => indicator.name === 'database');
  const ms = found === undefined ? undefined : reachableIn.exec(found.detail)?.[1];
  return ms === undefined ? null : Number(ms);
}

export async function frameOf(
  c: Context<AppEnv>,
  read: () => Promise<FrameCounts> | null,
): Promise<Frame> {
  const counts = (await read()) ?? noCounts;
  const report = (await c.get('frameHealth')?.()) ?? null;
  const now = c.get('now');
  const loaded = formatInstant(now).slice(formatDate(now).length + 1);
  return {
    sections: sectionsOf(counts, watching(report)),
    person: personOf(c.get('principal')),
    waiting: counts.waiting,
    markPath,
    status: {
      loaded,
      agents: counts.agentsWorking,
      gatesOpen: counts.gatesOpen,
      queue: switchedOn(report, 'queue'),
      live: switchedOn(report, 'live_hub'),
      databaseMs: databaseMsOf(report),
      commit: commitOf(c.env),
      environment: environmentOf(c.env),
    },
  };
}
