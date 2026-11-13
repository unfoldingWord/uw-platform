import type { Context } from 'hono';
import { formatDate, formatInstant } from '@uw/core/dates';
import type { HealthIndicator, HealthReport, Principal } from '@uw/contracts';
import type { FrameCounts } from '@uw/harness';
import type { Frame } from '@uw/ui/components/shell.tsx';
import type { NavItem, NavSection, Person } from '@uw/ui/components/sidebar.tsx';
import { wordmarkPath } from '@uw/ui/generated/mark';
import type { AppEnv } from '../../deps.ts';
import { commitOf, environmentOf } from '../../env.ts';
import { boardPath, flowPath, healthPath, homePath } from './paths.ts';
import { moduleCodes, noModules, platformAreas, type PlatformModule } from './names.ts';

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

function builtItems(module: PlatformModule, counts: FrameCounts, watch: number): NavItem[] {
  const base = { label: module.label, icon: module.icon };
  if (module.built === 'today') {
    const waiting = counts.waiting;
    return [
      {
        ...base,
        href: homePath(),
        code: moduleCodes.today,
        ...(waiting === 0
          ? {}
          : { count: { kind: 'person', count: waiting, label: `${waiting} waiting on you` } }),
      },
    ];
  }
  if (module.built === 'health')
    return [
      {
        ...base,
        href: healthPath(),
        code: moduleCodes.health,
        ...(watch === 0 ? {} : { count: { kind: 'watch', text: `${watch} watch` } }),
      },
    ];
  if (module.built === 'agentQueues')
    return [
      { ...base, code: moduleCodes.agentQueues, href: firstFlow(counts) },
      ...counts.harnesses.map(({ harness, open }) => ({
        label: harness.title,
        href: boardPath(harness.id),
        nested: true,
        count: { kind: 'quiet' as const, text: String(open) },
      })),
    ];
  return [base];
}

function firstFlow(counts: FrameCounts): string {
  const first = counts.harnesses[0];
  return first === undefined ? homePath() : flowPath(first.harness.id);
}

export function sectionsOf(counts: FrameCounts, watch: number): readonly NavSection[] {
  return platformAreas.map((area) => ({
    heading: area.name,
    code: area.code,
    items: area.modules.flatMap((module) => builtItems(module, counts, watch)),
    ...(area.modules.length === 0 ? { empty: noModules } : {}),
  }));
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
    wordmarkPath,
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
