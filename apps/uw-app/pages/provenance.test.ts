import { describe, expect, it } from 'vitest';
import { learningProvenance } from './provenance.ts';

const repo = 'unfoldingWord/tc-admin-app';
const base = {
  confidence: 'observed',
  as_of: '2026-10-15',
  supersedes: [],
  review_by: null,
  contradicts: false,
  source: 'platform',
  pull_request: null,
};
const pull = { repo, number: 7 };
const bench = { repository: repo };

describe('PI-2 where a learning came from', () => {
  it('PI-2 an external runner on a review delegation writes an external learning naming its pull request', () => {
    const parsed = { ...base, pull_request: pull };
    expect(
      learningProvenance({ parsed, raw: { pull_request: pull }, prior: null, writer: bench }),
    ).toEqual({
      ok: true,
      frontmatter: { ...parsed, source: 'external' },
    });
  });

  it('PI-2 refuses an external learning without its pull request or naming another repository', () => {
    expect(learningProvenance({ parsed: base, raw: {}, prior: null, writer: bench })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
    const elsewhere = { ...base, pull_request: { repo: 'unfoldingWord/uw-platform', number: 7 } };
    expect(learningProvenance({ parsed: elsewhere, raw: {}, prior: null, writer: bench })).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });

  it('PI-2 a person or another writer is the platform and cannot claim external', () => {
    expect(learningProvenance({ parsed: base, raw: {}, prior: null, writer: null })).toMatchObject({
      ok: true,
      frontmatter: { source: 'platform' },
    });
    const claimed = { ...base, source: 'external', pull_request: pull };
    const raw = { source: 'external' };
    expect(learningProvenance({ parsed: claimed, raw, prior: null, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
  });

  it('PI-2 an edit keeps an external learning external and its pull request fixed', () => {
    const prior = { source: 'external' as const, pullRequest: pull };
    const kept = { ...base, pull_request: pull };
    expect(learningProvenance({ parsed: kept, raw: {}, prior, writer: null })).toMatchObject({
      ok: true,
      frontmatter: { source: 'external', pull_request: pull },
    });
    const moved = { ...base, pull_request: { repo, number: 8 } };
    expect(learningProvenance({ parsed: moved, raw: {}, prior, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
  });
});

describe('PI-2 a platform learning names no pull request', () => {
  it('PI-2 a platform learning carries no pull request, written or edited', () => {
    const named = { ...base, pull_request: pull };
    const raw = { pull_request: pull };
    expect(learningProvenance({ parsed: named, raw, prior: null, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
    const prior = { source: 'platform' as const, pullRequest: null };
    expect(learningProvenance({ parsed: named, raw, prior, writer: null })).toEqual({
      ok: false,
      reason: 'malformed_command',
    });
  });
});
