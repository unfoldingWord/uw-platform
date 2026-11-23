import { gateLink, homeLink, itemLink } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import {
  queuePath,
  checksUrl,
  flowPath,
  gatePath,
  gatesPath,
  healthPath,
  homePath,
  issueUrl,
  itemPath,
  logOutPath,
  personPath,
  pullRequestUrl,
  reviewUrl,
  waitingPath,
} from './paths.ts';

const harness = 'e7000000-0000-4000-8000-000000000001';
const item = 'e7000000-0000-4000-8000-000000000002';
const pull = { repo: 'unfoldingWord/uw-platform', number: 44 };

describe('the view paths', () => {
  it('names every screen by ids, never by keys', () => {
    expect([homePath(), gatesPath(), healthPath(), healthPath('spend')]).toEqual([
      '/',
      '/gates',
      '/health',
      '/health/spend',
    ]);
    expect(flowPath(harness)).toBe(`/harnesses/${harness}`);
    expect(queuePath(harness)).toBe(`/harnesses/${harness}/queue`);
    expect(waitingPath(harness)).toBe(`/harnesses/${harness}/waiting`);
    expect(queuePath(harness, 'build')).toBe(`/harnesses/${harness}/queue?stage=build`);
    expect(gatePath(harness, item)).toBe(`/harnesses/${harness}/gates/${item}`);
    expect(itemPath(harness, item)).toBe(`/harnesses/${harness}/items/${item}`);
  });

  it('opens a person at their directory row, the one profile', () => {
    expect(personPath(harness)).toBe(`/collections/directory/rows/${harness}`);
  });

  it('agrees with the deep links a wake carries', () => {
    expect(gatePath(harness, item)).toBe(gateLink(harness, item));
    expect(itemPath(harness, item)).toBe(itemLink(harness, item));
    expect(homePath()).toBe(homeLink);
  });

  it('links a pull request, its checks, its reviews and an issue on GitHub', () => {
    const base = 'https://github.com/unfoldingWord/uw-platform';
    expect(pullRequestUrl(pull)).toBe(`${base}/pull/44`);
    expect(checksUrl(pull)).toBe(`${base}/pull/44/checks`);
    expect(reviewUrl(pull)).toBe(`${base}/pull/44/files`);
    expect(reviewUrl(pull, 7)).toBe(`${base}/pull/44#pullrequestreview-7`);
    expect(issueUrl({ ...pull, number: 12, githubId: 99 })).toBe(`${base}/issues/12`);
  });

  it("#149 logs out through the Cloudflare Access logout on the app's own host", () => {
    expect(logOutPath()).toBe('/cdn-cgi/access/logout');
  });
});
