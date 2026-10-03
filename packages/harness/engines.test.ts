import { engineSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { engineDescriptor, engineDescriptors, hostable } from './engines.ts';
import { reviewerIdentities } from './github/reviewers.ts';
import { runShapes, workflowRunSteps } from './runs/shapes.ts';

describe('HE-2 the engine registry names every engine key once, as data', () => {
  it('HE-2 every engine key has exactly one descriptor', () => {
    expect(engineDescriptors().map((descriptor) => descriptor.key)).toEqual(engineSchema.options);
    for (const key of engineSchema.options) expect(engineDescriptor(key).key).toBe(key);
  });

  it('refuses a key that is not an engine', () => {
    expect(() => engineDescriptor('gpt-sandbox' as never)).toThrow();
  });
});

describe('engine descriptors name each Reviewer identity', () => {
  it('the codex engine reviews as the second Reviewer identity', () => {
    const reviewers = new Set(reviewerIdentities.map((identity) => identity.reviewer));
    expect(engineDescriptor('codex-sandbox').reviewer).toBe('uw-reviewer-codex');
    expect(engineDescriptor('claude-messages').reviewer).toBe('uw-reviewer');
    expect(engineDescriptor('openrouter-messages').reviewer).toBe('uw-reviewer');
    expect(reviewers.has('uw-reviewer-codex')).toBe(true);
    expect(reviewers.has('uw-reviewer')).toBe(true);
  });
});

describe('HE-10 the reserved engine', () => {
  it('HE-10 claude-managed-agent is reserved', () => {
    expect(engineDescriptor('claude-managed-agent').availability).toBe('reserved');
    const reserved = engineDescriptors().filter((d) => d.availability === 'reserved');
    expect(reserved.map((d) => d.key)).toEqual(['claude-managed-agent']);
  });

  it('HE-10 no descriptor lets a reserved engine host a run', () => {
    expect(hostable('claude-managed-agent', 'workflow-run')).toBe(false);
    expect(hostable('external', 'workflow-run')).toBe(false);
    expect(hostable('external', 'external-run')).toBe(true);
    expect(hostable('openrouter-messages', 'workflow-run')).toBe(true);
    expect(hostable('openrouter-messages', 'external-run')).toBe(false);
  });
});

describe('run shapes', () => {
  it('a workflow run steps read, scout, work, submit on the platform at a metered cost', () => {
    expect(workflowRunSteps).toEqual(['read', 'scout', 'work', 'submit']);
    expect(runShapes['workflow-run']).toEqual({ host: 'platform', costBasis: 'metered' });
    expect(runShapes['external-run']).toEqual({ host: 'external', costBasis: 'subscription' });
  });
});
