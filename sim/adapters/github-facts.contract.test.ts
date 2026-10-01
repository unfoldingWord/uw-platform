import { describeGithubFactsContract } from '@uw/harness/port-contracts/github-facts';
import { createSimGitHubFacts } from './github-facts.ts';

describeGithubFactsContract('the scripted sim GitHub facts', async () => {
  const facts = createSimGitHubFacts();
  return { facts, given: async (known) => facts.given(known) };
});
