import { describe, expect, it } from 'vitest';
import { reviewerAppsOf } from './reviewer-apps.ts';

const reviewer = {
  REVIEWER_GITHUB_APP_ID: '11',
  REVIEWER_GITHUB_APP_INSTALLATION_ID: '12',
  REVIEWER_GITHUB_APP_PRIVATE_KEY: 'pkcs8-reviewer',
};
const codex = {
  REVIEWER_CODEX_GITHUB_APP_ID: '21',
  REVIEWER_CODEX_GITHUB_APP_INSTALLATION_ID: '22',
  REVIEWER_CODEX_GITHUB_APP_PRIVATE_KEY: 'pkcs8-codex',
};

describe('the Reviewer App configuration', () => {
  it('names each Reviewer identity by its own App, apart from the harness App', () => {
    const apps = reviewerAppsOf({ ...reviewer, ...codex, GITHUB_APP_ID: '1' });
    expect([...apps.entries()]).toEqual([
      ['uw-reviewer', { appId: '11', installationId: '12', privateKey: 'pkcs8-reviewer' }],
      ['uw-reviewer-codex', { appId: '21', installationId: '22', privateKey: 'pkcs8-codex' }],
    ]);
  });

  it('leaves out a Reviewer whose App is missing any part', () => {
    const apps = reviewerAppsOf({ ...reviewer, REVIEWER_CODEX_GITHUB_APP_ID: '21' });
    expect([...apps.keys()]).toEqual(['uw-reviewer']);
    expect(reviewerAppsOf({}).size).toBe(0);
  });
});
