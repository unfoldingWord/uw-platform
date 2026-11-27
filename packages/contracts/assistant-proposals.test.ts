import { describe, expect, it } from 'vitest';
import lock from './contract-lock.json' with { type: 'json' };
import {
  ASSISTANT_PROPOSAL_DAYS,
  assistantProposalDecisionSchema,
  assistantProposalKindSchema,
  assistantProposalPayloadSchemas,
  assistantProposalRefusalSchema,
  assistantProposalStatusSchema,
  decideAssistantProposalCommandSchema,
  proposedEffectOf,
} from './assistant-proposals.ts';
import {
  assistantDirectEffectSchema,
  assistantEffectFailureSchema,
  assistantEffectKindSchema,
  assistantProposedEffectSchema,
} from './assistants.ts';
import { untrustedSourceSchema, wakeReasonSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { proposalLink } from './notify.ts';
import { errorReasonSchema } from './outcomes.ts';
import { platformCommandNameSchema } from './platform-commands.ts';
import { schemaRegistry } from './registry.ts';
import { verbIo } from './verb-io.ts';
import { isForbiddenVerbName } from './verb-names.ts';
import { findVerb } from './verbs.ts';
import { CONTRACT_VERSION } from './version.ts';

const id = '00000000-0000-4000-8000-0000000000f1';
const other = '00000000-0000-4000-8000-0000000000f2';
const digest = 'a'.repeat(64);

describe('PA-12 proposals are a closed set its person decides', () => {
  it('closes the kinds, statuses, decisions and refusals', () => {
    expect([...assistantProposalKindSchema.options]).toEqual(['email', 'invite', 'page_append']);
    expect([...assistantProposalStatusSchema.options]).toEqual([
      'pending',
      'accepted',
      'declined',
      'expired',
    ]);
    expect([...assistantProposalDecisionSchema.options]).toEqual(['accept', 'decline']);
    expect(assistantProposalRefusalSchema.safeParse('proposal_changed').success).toBe(true);
    expect(assistantProposalRefusalSchema.safeParse('already_decided').success).toBe(true);
    expect(schemaRegistry['assistant-proposal-kind']).toBe(assistantProposalKindSchema);
    expect(ASSISTANT_PROPOSAL_DAYS).toBe(7);
  });

  it('keeps the proposed effects apart from the direct set and maps each kind to one', () => {
    expect([...assistantProposedEffectSchema.options]).toEqual([
      'email_sent',
      'invite_sent',
      'page_appended',
    ]);
    for (const kind of assistantProposedEffectSchema.options) {
      expect(assistantDirectEffectSchema.safeParse(kind).success).toBe(false);
      expect(assistantEffectKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(proposedEffectOf('email')).toBe('email_sent');
    expect(proposedEffectOf('invite')).toBe('invite_sent');
    expect(proposedEffectOf('page_append')).toBe('page_appended');
    for (const why of ['workspace_refused', 'workspace_unavailable', 'page_refused']) {
      expect(assistantEffectFailureSchema.safeParse(why).success).toBe(true);
    }
  });
});

describe('PA-12 proposals leave a content-free trail and wake their person', () => {
  it('records proposals with ids and closed values only, never their text', () => {
    for (const name of [
      'assistant_proposal_drafted',
      'assistant_proposal_decided',
      'assistant_proposal_expired',
    ]) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
    const drafted = eventEvidenceSchemas.assistant_proposal_drafted;
    expect(drafted.safeParse({ proposalId: id, requestId: other, kind: 'email' }).success).toBe(
      true,
    );
    expect(
      drafted.safeParse({ proposalId: id, requestId: other, kind: 'email', subject: 'Hi' }).success,
    ).toBe(false);
    const decided = eventEvidenceSchemas.assistant_proposal_decided;
    expect(decided.safeParse({ proposalId: id, kind: 'invite', decision: 'accept' }).success).toBe(
      true,
    );
    expect(decided.safeParse({ proposalId: id, kind: 'invite', decision: 'yes' }).success).toBe(
      false,
    );
    const expired = eventEvidenceSchemas.assistant_proposal_expired;
    expect(expired.safeParse({ proposalId: id }).success).toBe(true);
  });

  it('wakes the person with a link to the one proposal', () => {
    expect(wakeReasonSchema.safeParse('proposal_waiting').success).toBe(true);
    expect(proposalLink(id)).toBe(`/assistant#proposal-${id}`);
    expect(() => proposalLink('not-a-uuid')).toThrow();
  });

  it('fences a meeting transcript as an untrusted source of its own', () => {
    expect(untrustedSourceSchema.safeParse('meeting_transcript').success).toBe(true);
  });
});

describe('PA-12 the decision command binds the digest the person saw', () => {
  it('takes one proposal, a decision and the digest, and is a platform command', () => {
    const command = {
      command: 'decide_assistant_proposal',
      requestId: id,
      proposalId: other,
      decision: 'accept',
      digest,
    };
    expect(decideAssistantProposalCommandSchema.safeParse(command).success).toBe(true);
    expect(
      decideAssistantProposalCommandSchema.safeParse({ ...command, digest: 'abc' }).success,
    ).toBe(false);
    expect(
      decideAssistantProposalCommandSchema.safeParse({ ...command, personId: id }).success,
    ).toBe(false);
    expect(platformCommandNameSchema.safeParse('decide_assistant_proposal').success).toBe(true);
    expect(errorReasonSchema.safeParse('proposal_not_decidable').success).toBe(true);
  });
});

describe('PA-13 the proposal verbs only draft, and carry no gate word', () => {
  it('registers three proposal verbs in the assistant group, served only in a turn', () => {
    for (const name of ['propose_email', 'propose_invite', 'propose_page_append']) {
      const verb = findVerb(name);
      expect(verb?.group).toBe('assistant');
      expect(verb?.servedInV1).toBe(false);
      expect(verb?.grant).toBeNull();
      expect(isForbiddenVerbName(name)).toBe(false);
    }
  });

  it('bounds an email to ten recipients and a subject and body', () => {
    const input = verbIo.propose_email.input;
    const mail = { to: ['ana@example.org'], subject: 'Notes', body: 'Here they are.' };
    expect(input.safeParse(mail).success).toBe(true);
    expect(input.safeParse({ ...mail, cc: ['ben@example.org'] }).success).toBe(true);
    expect(input.safeParse({ ...mail, to: [] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, n) => `p${String(n)}@example.org`);
    expect(input.safeParse({ ...mail, to: eleven }).success).toBe(false);
    expect(input.safeParse({ ...mail, bcc: ['x@example.org'] }).success).toBe(false);
    expect(
      verbIo.propose_email.output.safeParse({ proposalId: id, status: 'pending' }).success,
    ).toBe(true);
  });

  it('gives an invite a title, two instants and its attendees', () => {
    const input = verbIo.propose_invite.input;
    const invite = {
      title: 'Planning',
      start: '2026-12-01T09:00:00Z',
      end: '2026-12-01T10:00:00Z',
      attendees: ['ana@example.org'],
    };
    expect(input.safeParse(invite).success).toBe(true);
    expect(input.safeParse({ ...invite, attendees: [] }).success).toBe(false);
    expect(input.safeParse({ ...invite, calendarId: 'x' }).success).toBe(false);
  });

  it('appends text to one page by id, with an optional heading', () => {
    const input = verbIo.propose_page_append.input;
    expect(input.safeParse({ pageId: id, text: 'Transcript summary' }).success).toBe(true);
    expect(input.safeParse({ pageId: id, heading: 'Notes', text: 'Summary' }).success).toBe(true);
    expect(input.safeParse({ pageId: id, text: '' }).success).toBe(false);
    expect(input.safeParse({ pageId: 'notes', text: 'x' }).success).toBe(false);
  });

  it('stores each kind with the same shape the verb drafted', () => {
    expect(assistantProposalPayloadSchemas.email).toBe(verbIo.propose_email.input);
    expect(assistantProposalPayloadSchemas.invite).toBe(verbIo.propose_invite.input);
    expect(assistantProposalPayloadSchemas.page_append).toBe(verbIo.propose_page_append.input);
  });
});

describe('the proposals contract version', () => {
  it('was published at 14.23.0 with its sets locked', () => {
    const entry = lock.versions.find((version) => version.version === '14.23.0');
    const sets: Record<string, readonly string[]> = entry?.sets ?? {};
    expect(sets['assistant-proposal-kind']).toEqual(['email', 'invite', 'page_append']);
  });
});

describe('the review-fixes contract version', () => {
  it('is published at 14.24.0 with a refused turn waking its person and a thrown step named', () => {
    expect(CONTRACT_VERSION).toBe('14.24.0');
    const entry = lock.versions.find((version) => version.version === '14.24.0');
    const sets: Record<string, readonly string[]> = entry?.sets ?? {};
    expect(sets['wake-reason']).toContain('assistant_refused');
    expect(sets['assistant-provisioning-failure']).toContain('step_failed');
  });
});
