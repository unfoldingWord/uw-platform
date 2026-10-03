import { notWiredCall, type Connectors, type GitHubFacts } from '@uw/harness';

export const unwiredDiff: GitHubFacts['diff'] = () => notWiredCall('githubFacts', 'diff');

export const unwiredReview: Connectors['review'] = () => notWiredCall('connectors', 'review');
