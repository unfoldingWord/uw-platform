import { describeGithubFactsContract } from '@uw/harness/port-contracts/github-facts';
import { createSimClock } from './clock.ts';
import { createSimGitHubFacts } from './github-facts.ts';

describeGithubFactsContract(
  'the scripted sim GitHub facts',
  async () => {
    const clock = createSimClock(new Date('2026-10-01T09:30:00.000Z'));
    const facts = createSimGitHubFacts(clock);
    return {
      facts,
      given: async (known) => facts.given(known),
      givenDiff: async (ref, range, text) => facts.setDiff(ref, range, text),
      now: () => clock.now(),
    };
  },
  'scripted',
);
