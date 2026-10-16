import { describe, expect, it } from 'vitest';
import { commandSchema } from './commands.ts';
import { intakeViaSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { epicPlaceSchema, itemStateSchema } from './harness.ts';
import { errorReasonSchema } from './outcomes.ts';

describe('EI-1 EI-2 EI-3 the contracts for epic intake', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa';
  const epicIssue = { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 };

  it('names the refusal and the intake routes', () => {
    expect(errorReasonSchema.options.at(-1)).toBe('done_when_missing');
    expect(intakeViaSchema.options).toEqual(['import', 'kickstart', 'enqueue_epic']);
  });

  it('enqueues an epic by repository and number, as import names an issue', () => {
    const command = { command: 'enqueue_epic', requestId, repository: epicIssue.repo, number: 40 };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(commandSchema.safeParse({ ...command, number: 0 }).success).toBe(false);
  });
});

describe('EI-1 EI-3 the epic place on an item and its creation', () => {
  const epicIssue = { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 };
  const subIssue = { repo: 'unfoldingWord/uw-platform', number: 41, githubId: 9100000341 };
  const place = { issue: epicIssue, title: 'Epic intake', position: 0 };

  it('reads an older item as in no epic with no blockers', () => {
    const older = {
      itemId: '00000000-0000-4000-8000-0000000000b1',
      harnessId: '00000000-0000-4000-8000-0000000000a1',
      stageKey: 'package',
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
      branchState: 'none',
      expectedHead: null,
      riskTier: null,
      riskDomains: [],
      pullRequest: null,
      issue: null,
      zulipTopic: null,
    };
    expect(itemStateSchema.parse(older)).toMatchObject({ epic: null, blockedBy: [] });
    expect(
      itemStateSchema.safeParse({ ...older, epic: place, blockedBy: [older.itemId] }).success,
    ).toBe(true);
    expect(epicPlaceSchema.safeParse({ ...place, position: -1 }).success).toBe(false);
  });

  it('carries the epic place and blockers on item_created only when given', () => {
    const created = {
      stage: 'package',
      title: 'Read the sub-issues',
      pageId: null,
      priority: 0,
      due: null,
      issue: subIssue,
    };
    const schema = eventEvidenceSchemas.item_created;
    expect(schema.parse(created)).toMatchObject({ epic: null, blockedBy: [] });
    expect(schema.safeParse({ ...created, epic: place, blockedBy: [] }).success).toBe(true);
  });
});

describe('EI-2 EI-3 the epic intake events', () => {
  const epicIssue = { repo: 'unfoldingWord/uw-platform', number: 40, githubId: 9100000340 };
  const subIssue = { repo: 'unfoldingWord/uw-platform', number: 41, githubId: 9100000341 };

  it('records an enqueued epic and a refusal for a missing done-when', () => {
    const enqueued = {
      epic: epicIssue,
      title: 'Epic intake',
      items: [
        {
          itemId: '00000000-0000-4000-8000-0000000000b1',
          issue: subIssue,
          created: true,
          blockedBy: [],
        },
      ],
      outside: [7],
      doneWhen: ['The sub-issues are read.'],
    };
    expect(eventEvidenceSchemas.epic_enqueued.safeParse(enqueued).success).toBe(true);
    const missing = {
      via: 'enqueue_epic',
      issue: subIssue,
      pageId: null,
      title: 'Read the sub-issues',
    };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(missing).success).toBe(true);
    const both = { ...missing, pageId: '00000000-0000-4000-8000-0000000000c1' };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(both).success).toBe(false);
    const neither = { ...missing, issue: null };
    expect(eventEvidenceSchemas.done_when_missing.safeParse(neither).success).toBe(false);
  });
});
