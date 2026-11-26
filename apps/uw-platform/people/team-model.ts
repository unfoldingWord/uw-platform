import type { AllocationTargetKind } from '@uw/contracts';

export type TeamMember = {
  readonly id: string;
  readonly name: string;
  readonly ring: string | null;
  readonly portfolioIds: readonly string[];
};

export type TeamPage =
  | {
      readonly id: string;
      readonly state: 'shown';
      readonly kind: AllocationTargetKind;
      readonly title: string;
      readonly portfolioId: string | null;
    }
  | {
      readonly id: string;
      readonly state: 'retired';
      readonly kind: AllocationTargetKind;
      readonly title: string;
    }
  | { readonly id: string; readonly state: 'hidden' };

type TeamCommitment = {
  readonly id: string;
  readonly fromId: string;
  readonly toPersonId: string | null;
  readonly toText: string | null;
};

type TeamAllocation = {
  readonly id: string;
  readonly personId: string;
  readonly pageId: string;
  readonly percent: number | null;
};

export type TeamRead = {
  readonly members: readonly TeamMember[];
  readonly pages: ReadonlyMap<string, TeamPage>;
  readonly commitments: readonly TeamCommitment[];
  readonly allocations: readonly TeamAllocation[];
};

export function pageOf(read: TeamRead, pageId: string): TeamPage {
  return read.pages.get(pageId) ?? { id: pageId, state: 'hidden' };
}

export function shownPortfolios(read: TeamRead): readonly { id: string; title: string }[] {
  return [...read.pages.values()]
    .flatMap((page) =>
      page.state === 'shown' && page.kind === 'portfolio'
        ? [{ id: page.id, title: page.title }]
        : [],
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
