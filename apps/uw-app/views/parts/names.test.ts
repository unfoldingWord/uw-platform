import { describe, expect, it } from 'vitest';
import type { NavSection } from '@uw/ui/components/sidebar.tsx';
import { sectionsOf } from './frame-data.ts';
import { isTitleCase, pageNames, titleCased } from './names.ts';

const noHarnesses = { harnesses: [], waiting: 0, gatesOpen: 0, agentsWorking: 0 };

function labels(sections: readonly NavSection[]): string[] {
  return sections.flatMap((section) => [
    ...(section.heading === undefined ? [] : [section.heading]),
    ...section.items.map((item) => item.label),
  ]);
}

const prototypeSidebar = [
  'unfoldingWord Home',
  'Today',
  'Pages & Wiki',
  'Strategic Cascade',
  'Meetings',
  'JD Crosswalk',
  'Internal Operations & Administration',
  'Directory & Access',
  'Finance',
  'Ledger',
  'Budgets & Charts',
  'Contracts & MOUs',
  'Expenses',
  'Compliance',
  'Infrastructure',
  'Health',
  'Agent Queues',
  'Modules',
  'Desktop & Offline',
  'Engage Benefactors',
  'CRM & Giving',
  'Grants',
  'Story Bank',
  'Innovation & Strategy',
  'Impact Models',
  'Field Programs',
  'Engagements',
  'Tech & SLR',
  'Products',
  'Development',
  'Catalyzation',
];

describe('UI-17 navigation and page names are Title Case', () => {
  it('UI-17 every page name and section name capitalizes every word', () => {
    for (const name of Object.values(pageNames)) expect(isTitleCase(name), name).toBe(true);
  });

  it('UI-17 every fixed label in the sidebar is Title Case', () => {
    const fixed = labels(sectionsOf(noHarnesses, 0));
    expect(fixed).toEqual(prototypeSidebar);
    for (const label of fixed) expect(isTitleCase(label), label).toBe(true);
  });

  it('UI-17 a sentence-case name fails, and unfoldingWord keeps its camelCase', () => {
    expect(isTitleCase('Waiting on you')).toBe(false);
    expect(isTitleCase('My items')).toBe(false);
    expect(isTitleCase('unfoldingWord Platform')).toBe(true);
  });

  it('UI-17 an indicator page name is title-cased without changing its capitals', () => {
    expect(titleCased('With a person over 24 hours')).toBe('With A Person Over 24 Hours');
    expect(titleCased('GitHub sweep')).toBe('GitHub Sweep');
  });
});
