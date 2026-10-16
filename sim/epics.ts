import type { Principal } from '@uw/contracts';
import type { EpicFacts, IssueFact, IssueKey } from '@uw/harness';
import { simCaller } from './fixtures.ts';
import type { World } from './world.ts';

export const epicRepository = 'unfoldingWord/uw-platform';
export const epicKey: IssueKey = { repo: epicRepository, number: 40 };

type FactOptions = {
  readonly blockedBy?: readonly number[];
  readonly doneWhen?: readonly string[];
  readonly open?: boolean;
};

export function epicFact(number: number, title: string, options: FactOptions = {}): IssueFact {
  return {
    issue: { repo: epicRepository, number, githubId: 9100000300 + number },
    title,
    open: options.open ?? true,
    doneWhen: options.doneWhen ?? [`${title} is merged and its tests pass.`],
    blockedBy: options.blockedBy ?? [],
  };
}

export function epicOf(subIssues: readonly IssueFact[], count = subIssues.length): EpicFacts {
  return {
    epic: epicFact(40, 'Epic intake', { doneWhen: [] }),
    subIssueCount: count,
    subIssues,
  };
}

export const epicOfFour: EpicFacts = epicOf([
  epicFact(41, 'Read the sub-issues'),
  epicFact(42, 'Require a done-when'),
  epicFact(43, 'Enqueue the epic'),
  epicFact(44, 'Show the epic on the Board', { blockedBy: [43] }),
]);

export function enqueueEpicAs(world: World, actor: Principal, harnessId: string, epic = epicKey) {
  return world.kernel.items.enqueueEpic(simCaller(world, actor), { harnessId, epic });
}
