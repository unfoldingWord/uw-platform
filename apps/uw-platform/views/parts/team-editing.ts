import { pageOf, type TeamPage, type TeamRead } from '../../people/team-model.ts';
import type { Listed } from './team-chart-parts.tsx';

type Choice = { readonly value: string; readonly label: string };

function pageWords(page: TeamPage): string {
  if (page.state === 'hidden') return 'a page you cannot read';
  return page.state === 'retired' ? `${page.title} (retired)` : page.title;
}

export function commitmentsBy(read: TeamRead, personId: string): readonly Listed[] {
  const names = new Map(read.members.map((member) => [member.id, member.name]));
  return read.commitments
    .filter((commitment) => commitment.fromId === personId)
    .map((commitment) => {
      const named =
        commitment.toPersonId === null
          ? `“${commitment.toText ?? ''}”`
          : (names.get(commitment.toPersonId) ?? 'a person you cannot read');
      return { id: commitment.id, label: `Committed to ${named}` };
    });
}

export function colleagueChoices(read: TeamRead, personId: string): readonly Choice[] {
  return read.members
    .filter((member) => member.id !== personId)
    .map((member) => ({ value: member.id, label: member.name }));
}

export function allocationList(read: TeamRead): readonly Listed[] {
  const names = new Map(read.members.map((member) => [member.id, member.name]));
  return read.allocations.flatMap((allocation) => {
    const person = names.get(allocation.personId);
    if (person === undefined) return [];
    const share = allocation.percent === null ? 'unspecified' : `${allocation.percent}%`;
    const page = pageWords(pageOf(read, allocation.pageId));
    return [{ id: allocation.id, label: `${person} on ${page}, ${share}` }];
  });
}

export function targetChoices(read: TeamRead): readonly Choice[] {
  return [...read.pages.values()]
    .flatMap((page) =>
      page.state === 'shown'
        ? [
            {
              value: `${page.kind}:${page.id}`,
              label: `${page.kind === 'program' ? 'Program' : 'Portfolio'} · ${page.title}`,
            },
          ]
        : [],
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function peopleChoices(read: TeamRead): readonly Choice[] {
  return read.members.map((member) => ({ value: member.id, label: member.name }));
}
