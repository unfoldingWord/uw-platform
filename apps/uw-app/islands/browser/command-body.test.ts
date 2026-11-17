import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';

const requestId = 'c8000000-0000-4000-8000-000000000001';
const check = 'c8000000-0000-4000-8000-000000000002';
const ship = 'c8000000-0000-4000-8000-000000000003';
const page = 'c8000000-0000-4000-8000-000000000004';

function stagesForm(): Record<string, string> {
  return {
    'stage.0.id': check,
    'stage.0.agentPickup': 'auto',
    'stage.0.exitGate': 'checks',
    'stage.0.wipLimit': '4',
    'stage.0.instructionsPageId': page,
    'stage.0.validator.lint': 'lint',
    'stage.0.validator.typecheck': 'typecheck',
    'stage.1.id': ship,
    'stage.1.agentPickup': 'none',
    'stage.1.exitGate': 'human_approval',
    'stage.1.wipLimit': '1',
    'stage.1.instructionsPageId': '',
  };
}

function gathersRows(): void {
  expect(commandBody('set_stage_rules', stagesForm(), requestId)).toEqual({
    command: 'set_stage_rules',
    requestId,
    stages: [
      {
        id: check,
        agentPickup: 'auto',
        exitGate: 'checks',
        wipLimit: 4,
        instructionsPageId: page,
        validators: ['lint', 'typecheck'],
      },
      {
        id: ship,
        agentPickup: 'none',
        exitGate: 'human_approval',
        wipLimit: 1,
        instructionsPageId: null,
        validators: [],
      },
    ],
  });
}

describe('#108 the Stages & controls forms become command bodies', () => {
  it('gathers each stage row, its page and its ticked checks into set_stage_rules', gathersRows);

  it('refuses a row whose limit is not a whole number of at least 1', () => {
    const form = { ...stagesForm(), 'stage.1.wipLimit': '0' };
    expect(commandBody('set_stage_rules', form, requestId)).toBeNull();
  });

  it('turns each switch on or off from its value', () => {
    expect(commandBody('set_shadow', { shadow: 'true' }, requestId)).toMatchObject({
      shadow: true,
    });
    expect(commandBody('set_hosted_builder', { enabled: 'false' }, requestId)).toMatchObject({
      enabled: false,
    });
    expect(commandBody('set_freeze', { frozen: 'true' }, requestId)).toMatchObject({
      frozen: true,
      allow: [],
    });
  });

  it('pauses and resumes one stage by key', () => {
    expect(commandBody('pause', { stageKey: 'build' }, requestId)).toMatchObject({
      command: 'pause',
      stageKey: 'build',
    });
    expect(commandBody('resume', { stageKey: 'build' }, requestId)).toMatchObject({
      stageKey: 'build',
    });
  });
});

describe('#110 the standing-permission forms become command bodies', () => {
  const delegationId = '00000000-0000-4000-8000-0000000000d1';

  it('grants a kind of work until the end of the chosen day', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: '2026-12-31' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toEqual({
      command: 'schedule_regular_tweak',
      requestId,
      persona: 'agent:reviewer',
      capability: 'review',
      expiresAt: '2026-12-31T23:59:59.000Z',
      supersedes: null,
      maxTier: null,
    });
  });

  it('leaves the end open when no day is chosen, and carries a merge tier', () => {
    const form = { grant: 'agent:merger|merge|low', expiresOn: '' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toMatchObject({
      expiresAt: null,
      maxTier: 'low',
    });
  });

  it('never sends a merge tier with work other than merge, whatever else the form holds', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: '', maxTier: 'low' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toMatchObject({
      capability: 'review',
      maxTier: null,
    });
  });

  it('refuses a day that is not a calendar date', () => {
    const form = { grant: 'agent:reviewer|review', expiresOn: 'soon' };
    expect(commandBody('schedule_regular_tweak', form, requestId)).toBeNull();
  });

  it('revokes one permission by id', () => {
    expect(commandBody('revoke_delegation', { delegationId }, requestId)).toEqual({
      command: 'revoke_delegation',
      requestId,
      delegationId,
    });
  });
});
