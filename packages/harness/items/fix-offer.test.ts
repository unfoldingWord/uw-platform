import {
  harnessSchema,
  identitySchema,
  itemStateSchema,
  stageSchema,
  type EventName,
  type HarnessEvent,
  type ReviewFinding,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { fixClosed, fixOffered, fixRound, onlyByFix, roundFindings } from './fix-offer.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const head = 'c'.repeat(40);
let position = 0;

function event(name: EventName, evidence: HarnessEvent['evidence']): HarnessEvent {
  position += 1;
  return {
    eventId: `00000000-0000-4000-8000-${position.toString().padStart(12, '0')}`,
    harnessId,
    itemId,
    name,
    position,
    at: '2026-10-15T09:00:00.000Z',
    actor: identitySchema.parse('agent:reviewer'),
    evidence,
    traceId: '00000000-0000-4000-8000-0000000000c1',
    requestId: null,
  };
}

function round(findings: readonly ReviewFinding[], verdict = 'request_changes'): HarnessEvent {
  const review = {
    reviewer: 'uw-reviewer',
    provider: 'deepinfra',
    model: 'z-ai/glm-5.3',
    verdict,
    reviewId: 9300000001,
    findings: findings.map((finding) => ({ ...finding })),
  };
  return event('run_completed', { runId: itemId, result: 'review_posted', gates: [], review });
}

const real: ReviewFinding = { text: 'The lease is never renewed.', weight: 'real' };
const theoretical: ReviewFinding = { text: 'A year of skew breaks it.', weight: 'theoretical' };
const submitted = event('submitted_to_gate', {
  stage: 'check',
  result: 'advanced',
  to: null,
  expectedHead: head,
  pullRequest: null,
  evidence: {},
});
const advanced = event('stage_advanced', { from: 'check', to: 'ship' });
const claimed = event('fix_claimed', { delegationId: itemId, head, declaration: null });

const harness = harnessSchema.parse({
  id: harnessId,
  key: 'board',
  template: 'software',
  jdArea: '80-89',
  repository: 'unfoldingWord/uw-platform',
  hostedBuilderEnabled: false,
  paused: false,
  fixClaim: true,
});

function stage(key: string, change: Record<string, unknown> = {}) {
  return stageSchema.parse({
    id: '00000000-0000-4000-8000-0000000000d1',
    harnessId,
    key,
    title: key,
    position: 50,
    bracket: 'build_package',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    validators: [],
    feeds: [],
    wipLimit: 3,
    paused: false,
    instructionsPageId: null,
    ...change,
  });
}

const item = itemStateSchema.parse({
  itemId,
  harnessId,
  stageKey: 'check',
  title: 'Show the board',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'working',
  gateTarget: null,
  branchState: 'active',
  expectedHead: head,
  riskTier: null,
  riskDomains: [],
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 42 },
  issue: null,
  zulipTopic: null,
});

describe('FL-2 the rules that open a fix', () => {
  it('FL-2 a counted round opens the fix, and a theoretical or approving round does not', () => {
    expect(fixRound([submitted, round([real])]).review).not.toBeNull();
    expect(fixRound([submitted, round([theoretical])]).review).toBeNull();
    expect(fixRound([submitted, round([real], 'approve')]).review).toBeNull();
  });

  it('FL-2 a new head or a stage change closes the round, and a fix claim spends it', () => {
    expect(fixRound([round([real]), submitted]).review).toBeNull();
    expect(fixRound([round([real]), advanced]).review).toBeNull();
    expect(fixRound([round([real]), claimed])).toMatchObject({ claimed: true });
    expect(fixRound([round([real]), claimed, submitted, round([real])])).toMatchObject({
      claimed: false,
    });
  });

  it('FL-1 FL-2 the harness switch, shadow mode and a joined pull request each close the offer', () => {
    const open = [submitted, round([real])];
    expect(fixOffered(harness, item, open)).toBe(true);
    expect(fixOffered({ ...harness, fixClaim: false }, item, open)).toBe(false);
    expect(fixOffered({ ...harness, shadow: true }, item, open)).toBe(false);
    expect(fixOffered(harness, { ...item, branchState: 'none' }, open)).toBe(false);
    expect(fixOffered(harness, { ...item, pullRequest: null }, open)).toBe(false);
  });

  it('FL-2 only the fix reach is gated, and a fix never reaches a delegable exit', () => {
    const check = stage('check');
    expect(onlyByFix(check, new Set(['fix']))).toBe(true);
    expect(onlyByFix(check, new Set(['fix', 'build']))).toBe(false);
    expect(onlyByFix(check, new Set(['build']))).toBe(false);
    expect(onlyByFix(check, null)).toBe(false);
    const ship = stage('ship', {
      bracket: 'deploy_package',
      agentPickup: 'none',
      exitGate: 'human_approval',
      connector: 'merge',
    });
    expect(onlyByFix(ship, new Set(['fix']))).toBe(false);
  });

  it('FL-4 the fix reads the round findings that are real or plausible, with their weight', () => {
    const plausible: ReviewFinding = { text: 'The empty state may drop.', weight: 'plausible' };
    expect(roundFindings([round([real, theoretical, plausible])])).toEqual([
      'real: The lease is never renewed.',
      'plausible: The empty state may drop.',
    ]);
    expect(roundFindings([round([real]), submitted])).toEqual([]);
  });
});

describe('FL-1 FL-2 why a fix is not offered', () => {
  it('FL-1 FL-2 a closed offer names its cause', () => {
    const open = [submitted, round([real])];
    expect(fixClosed(harness, item, open)).toBeNull();
    expect(fixClosed({ ...harness, fixClaim: false }, item, open)).toBe('fix_claim_off');
    expect(fixClosed({ ...harness, shadow: true }, item, open)).toBe('shadow');
    expect(fixClosed(harness, { ...item, pullRequest: null }, open)).toBe('no_pull_request');
    expect(fixClosed(harness, { ...item, branchState: 'none' }, open)).toBe('joined_pull_request');
    expect(fixClosed(harness, item, [round([real]), claimed])).toBe('no_review_round');
  });
});
