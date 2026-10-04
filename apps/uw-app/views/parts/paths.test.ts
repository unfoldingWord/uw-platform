import { describe, expect, it } from 'vitest';
import {
  boardPath,
  checksUrl,
  flowPath,
  gatePath,
  gatesPath,
  healthPath,
  homePath,
  issueUrl,
  itemPath,
  pullRequestUrl,
  reviewUrl,
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
    expect(boardPath(harness)).toBe(`/harnesses/${harness}/board`);
    expect(boardPath(harness, 'build')).toBe(`/harnesses/${harness}/board?stage=build`);
    expect(gatePath(harness, item)).toBe(`/harnesses/${harness}/gates/${item}`);
    expect(itemPath(harness, item)).toBe(`/harnesses/${harness}/items/${item}`);
  });

  it('links a pull request, its checks, its reviews and an issue on GitHub', () => {
    const base = 'https://github.com/unfoldingWord/uw-platform';
    expect(pullRequestUrl(pull)).toBe(`${base}/pull/44`);
    expect(checksUrl(pull)).toBe(`${base}/pull/44/checks`);
    expect(reviewUrl(pull)).toBe(`${base}/pull/44/files`);
    expect(reviewUrl(pull, 7)).toBe(`${base}/pull/44#pullrequestreview-7`);
    expect(issueUrl({ ...pull, number: 12, githubId: 99 })).toBe(`${base}/issues/12`);
  });
});
