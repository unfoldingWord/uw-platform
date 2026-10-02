import { describe, expect, it } from 'vitest';
import { normalisedIdentifier } from './identifiers.ts';
import { reviewerIdentities, reviewerOf } from './reviewers.ts';

describe('GH-5 only listed Reviewer identities are reviewers', () => {
  it('maps each listed bot login to its reviewer, whatever its case', () => {
    expect(reviewerOf('uw-reviewer[bot]')).toBe('uw-reviewer');
    expect(reviewerOf('UW-Reviewer[bot]')).toBe('uw-reviewer');
    expect(reviewerOf('uw-reviewer-codex[bot]')).toBe('uw-reviewer-codex');
  });

  it('counts a user named like the bot, or any other login, as no reviewer', () => {
    expect(reviewerOf('uw-reviewer')).toBeNull();
    expect(reviewerOf('octocat')).toBeNull();
    expect(reviewerOf('')).toBeNull();
  });

  it('counts a non-ASCII lookalike of a listed login as no reviewer', () => {
    expect(reviewerOf('\uFF55\uFF57-reviewer\uFF3Bbot\uFF3D')).toBeNull();
    expect(reviewerOf('uw-reviewer[bot]\u200B')).toBeNull();
  });
});

describe('the Reviewer identity list', () => {
  it('names every reviewer in normalised form under distinct logins', () => {
    for (const entry of reviewerIdentities) {
      expect(normalisedIdentifier(entry.reviewer)).toBe(entry.reviewer);
    }
    const logins = reviewerIdentities.map((entry) => entry.login.toLowerCase());
    expect(new Set(logins).size).toBe(logins.length);
  });
});
